package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// هدفی که همین حالا گذشته، نباید به فردا برود: همان لحظه می‌ماند تا فوراً
// شلیک شود.
func TestNextOccurrenceKeepsJustPassedTime(t *testing.T) {
	loc := Tehran()
	now := time.Date(2026, 3, 10, 8, 30, 1, 0, loc)
	target := NextOccurrenceAt(now, 8, 30, 0, 0)
	if target.In(loc).Day() != 10 || target.In(loc).Format("15:04:05") != "08:30:00" {
		t.Errorf("لحظهٔ هدف نباید جابه‌جا می‌شد: %v", target.In(loc))
	}
}

// ولی هدفی که واقعاً گذشته (بیش از مهلت ارفاق) مربوط به فرداست.
func TestNextOccurrenceRollsAfterGrace(t *testing.T) {
	loc := Tehran()
	now := time.Date(2026, 3, 10, 8, 30, 10, 0, loc)
	target := NextOccurrenceAt(now, 8, 30, 0, 0)
	if target.In(loc).Day() != 11 {
		t.Errorf("باید فردا می‌شد: %v", target.In(loc))
	}
}

// اگر لحظهٔ شلیک گذشته باشد، حلقه باید از همین حالا شروع کند — نه رگبار
// جبرانی بزند و نه به بهانهٔ «سقف مدت» هیچ ارسالی نکند.
func TestFireStartsNowWhenTargetAlreadyPassed(t *testing.T) {
	engine := newArmedEngine()
	sender := &stubSender{}
	cfg := fireConfig(FireCount)
	cfg.Retries = 3
	cfg.MaxDurationS = 5

	started := time.Now()
	engine.fire(cfg, LocalClock(), sender, time.Now().Add(-30*time.Second))
	if got := atomic.LoadInt64(&sender.sent); got != 3 {
		t.Fatalf("باید ۳ ارسال می‌شد، شد %d", got)
	}
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Errorf("شلیک نباید %v طول می‌کشید", elapsed)
	}
}

// تست سرتاسری: هدفی که فقط چند ثانیه فاصله دارد باید همان امروز شلیک شود.
// قبلاً لحظهٔ هدف *بعد از* مقدمات حساب می‌شد و چنین هدفی به فردا می‌افتاد.
func TestArmWithFewSecondsLeftFiresToday(t *testing.T) {
	var hits int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		atomic.AddInt64(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"isSuccessful":true,"message":"ok"}`))
	}))
	defer server.Close()

	cfg := baseConfig()
	cfg.BaseURL = server.URL
	cfg.OrderURL = server.URL + "/core/api/v2/order"
	cfg.OrderPath = "/core/api/v2/order"
	cfg.LeadMs = 0
	cfg.FireMode = FireCount
	cfg.Retries = 1
	cfg.RetryGapMs = MinGapMs
	cfg.MaxDurationS = 10
	cfg.PriceMode = PriceLimit
	cfg.LimitPrice = 5400

	at := time.Now().In(Tehran()).Add(3 * time.Second)
	cfg.TargetHour, cfg.TargetMinute = at.Hour(), at.Minute()
	cfg.TargetSecond, cfg.TargetMillis = at.Second(), at.Nanosecond()/int(time.Millisecond)

	engine := NewEngine()
	if err := engine.Arm(cfg, bandLimits()); err != nil {
		t.Fatalf("مسلح نشد: %v", err)
	}

	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		if state := engine.Snapshot(); state.Finished {
			if !state.Accepted {
				t.Fatalf("سفارش پذیرفته نشد: %s | %v", state.Summary, state.Log)
			}
			if atomic.LoadInt64(&hits) == 0 {
				t.Fatal("هیچ درخواستی به کارگزار نرسید")
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	engine.Cancel()
	t.Fatalf("اجرا تمام نشد؛ هدف احتمالاً به فردا افتاده است: %v", engine.Snapshot().Log)
}

// زمانی که کاربر صرف تأیید سفارش می‌کند نباید هدف را از دست بدهد: مبدأ
// محاسبه، لحظهٔ فشردن دکمه است.
func TestArmCountsFromClickNotFromRequest(t *testing.T) {
	var hits int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		atomic.AddInt64(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"isSuccessful":true,"message":"ok"}`))
	}))
	defer server.Close()

	cfg := baseConfig()
	cfg.BaseURL = server.URL
	cfg.OrderURL = server.URL + "/core/api/v2/order"
	cfg.OrderPath = "/core/api/v2/order"
	cfg.LeadMs = 0
	cfg.FireMode = FireCount
	cfg.Retries = 1
	cfg.RetryGapMs = MinGapMs
	cfg.MaxDurationS = 10
	cfg.PriceMode = PriceLimit
	cfg.LimitPrice = 5400

	// هدف چهار ثانیه *پیش* از حالا، ولی دکمه شش ثانیه پیش زده شده است.
	at := time.Now().In(Tehran()).Add(-4 * time.Second)
	cfg.TargetHour, cfg.TargetMinute = at.Hour(), at.Minute()
	cfg.TargetSecond, cfg.TargetMillis = at.Second(), at.Nanosecond()/int(time.Millisecond)
	cfg.ClickAgoMs = 6000

	engine := NewEngine()
	if err := engine.Arm(cfg, bandLimits()); err != nil {
		t.Fatalf("مسلح نشد: %v", err)
	}
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if state := engine.Snapshot(); state.Finished {
			if !state.Accepted || atomic.LoadInt64(&hits) == 0 {
				t.Fatalf("سفارش ارسال نشد: %s | %v", state.Summary, state.Log)
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	engine.Cancel()
	t.Fatalf("هدف به فردا افتاد: %v", engine.Snapshot().Log)
}
