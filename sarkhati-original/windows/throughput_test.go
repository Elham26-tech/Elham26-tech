package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// فرستندهٔ ساختگی با تأخیر پاسخِ واقعی، برای سنجیدن نرخ ارسال.
type slowSender struct {
	latency time.Duration
	lanes   int
	sent    int64
	busy    int64
	peak    int64
}

func (s *slowSender) Prepare(price int64) error { return nil }
func (s *slowSender) KeepAlive()                {}
func (s *slowSender) Close()                    {}
func (s *slowSender) Parallelism() int          { return s.lanes }
func (s *slowSender) Send(attempt int) Result {
	inflight := atomic.AddInt64(&s.busy, 1)
	for {
		peak := atomic.LoadInt64(&s.peak)
		if inflight <= peak || atomic.CompareAndSwapInt64(&s.peak, peak, inflight) {
			break
		}
	}
	time.Sleep(s.latency)
	atomic.AddInt64(&s.busy, -1)
	atomic.AddInt64(&s.sent, 1)
	return Result{Detail: "محدوده زمانی سفارش معتبر نمی‌باشد!"}
}

// هستهٔ مشکلِ گزارش‌شده: با پاسخ ۶۰ میلی‌ثانیه‌ای و فاصلهٔ ۲۰ میلی‌ثانیه، حلقهٔ
// تک‌رشته‌ای فقط ۱۶ ارسال در ثانیه می‌کرد. حالا باید به نرخ خواسته‌شده برسد.
func TestFireReachesRequestedRate(t *testing.T) {
	engine := newArmedEngine()
	sender := &slowSender{latency: 60 * time.Millisecond, lanes: 8}
	cfg := fireConfig(FireCount)
	cfg.Retries = 40
	cfg.RetryGapMs = 20
	cfg.MaxDurationS = 30

	started := time.Now()
	engine.fire(cfg, LocalClock(), sender, time.Now())
	elapsed := time.Since(started)

	if got := atomic.LoadInt64(&sender.sent); got != 40 {
		t.Fatalf("باید ۴۰ ارسال می‌شد، شد %d", got)
	}
	// ۴۰ ارسال با فاصلهٔ ۲۰ میلی‌ثانیه یعنی حدود ۰٫۸ ثانیه. مدل قدیمی
	// (سریالی) ۴۰×۶۰ = ۲٫۴ ثانیه طول می‌کشید.
	if elapsed > 1400*time.Millisecond {
		t.Errorf("نرخ ارسال هنوز به فاصلهٔ خواسته‌شده نرسیده است: %v", elapsed)
	}
	if peak := atomic.LoadInt64(&sender.peak); peak < 2 {
		t.Errorf("ارسال‌ها موازی نشدند: بیشترین هم‌زمانی %d", peak)
	}
}

// نوبت‌ها نباید در صف بمانند: خطای زمانی هر ارسال باید نزدیک صفر باشد، نه
// اینکه مثل گزارش کاربر به چند ثانیه برسد.
func TestFireKeepsScheduleUnderLoad(t *testing.T) {
	engine := newArmedEngine()
	sender := &slowSender{latency: 60 * time.Millisecond, lanes: 8}
	cfg := fireConfig(FireCount)
	cfg.Retries = 30
	cfg.RetryGapMs = 20
	cfg.MaxDurationS = 30

	clock := LocalClock()
	fireAt := clock.Now()
	engine.fire(cfg, clock, sender, fireAt)

	// آخرین نوبت باید حوالی fireAt + ۲۹×۲۰ms انجام شده باشد.
	if drift := clock.Now().Sub(fireAt) - 30*20*time.Millisecond; drift > 400*time.Millisecond {
		t.Errorf("برنامهٔ زمانی عقب افتاد: %v", drift)
	}
}

// استخر اتصال‌ها باید واقعاً موازی کار کند و اتصال‌ها را دوباره استفاده کند.
func TestAPISenderPoolIsParallel(t *testing.T) {
	var hits int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		if r.Method == http.MethodPost {
			atomic.AddInt64(&hits, 1)
			time.Sleep(50 * time.Millisecond)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"isSuccessful":false,"message":"بسته است"}`))
	}))
	defer server.Close()

	cfg := baseConfig()
	cfg.BaseURL = server.URL
	cfg.OrderURL = server.URL + "/core/api/v2/order"
	cfg.Connections = 6

	sender := NewAPISender(cfg)
	if err := sender.Prepare(5400); err != nil {
		t.Fatalf("آماده‌سازی ناموفق: %v", err)
	}
	defer sender.Close()
	if got := sender.Parallelism(); got != 6 {
		t.Fatalf("استخر باید ۶ اتصال داشته باشد، دارد %d", got)
	}

	started := time.Now()
	done := make(chan Result, 6)
	for i := 0; i < 6; i++ {
		go func(n int) { done <- sender.Send(n) }(i)
	}
	for i := 0; i < 6; i++ {
		<-done
	}
	elapsed := time.Since(started)

	if atomic.LoadInt64(&hits) != 6 {
		t.Errorf("۶ سفارش باید می‌رسید، رسید %d", atomic.LoadInt64(&hits))
	}
	// شش ارسال موازی روی شش اتصال ≈ یک تأخیر، نه شش تا.
	if elapsed > 200*time.Millisecond {
		t.Errorf("ارسال‌ها سریالی شدند: %v", elapsed)
	}
}

// بدنهٔ هر ارسال باید از نو ساخته شود تا زمانِ داخل سفارش تازه باشد.
func TestRequestBodyIsRebuiltEachSend(t *testing.T) {
	cfg := baseConfig()
	cfg.OrderDateSample = "1/2/2006, 3:04:05 PM"
	cfg.PayloadTemplate = `{"createDateTime":"{now}","price":{price}}`
	sender := NewAPISender(cfg)
	sender.host = "example.com"

	first := string(sender.BuildRequest(5400))
	time.Sleep(1100 * time.Millisecond)
	second := string(sender.BuildRequest(5400))
	if first == second {
		t.Error("زمانِ داخل سفارش به‌روز نشد؛ کارگزار آن را خارج از محدودهٔ زمانی می‌داند")
	}
}
