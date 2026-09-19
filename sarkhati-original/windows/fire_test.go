package main

import (
	"fmt"
	"sync/atomic"
	"testing"
	"time"
)

// فرستندهٔ ساختگی برای سنجیدن حلقهٔ شلیک.
type stubSender struct {
	sent      int64
	acceptAt  int
	fatalAt   int
	rejectMsg string
}

func (s *stubSender) Prepare(price int64) error { return nil }
func (s *stubSender) KeepAlive()                {}
func (s *stubSender) Close()                    {}
func (s *stubSender) Send(attempt int) Result {
	n := int(atomic.AddInt64(&s.sent, 1))
	if s.acceptAt > 0 && n >= s.acceptAt {
		return Result{Accepted: true, Detail: "پذیرفته شد"}
	}
	if s.fatalAt > 0 && n >= s.fatalAt {
		return Result{Detail: "توکن منقضی شده", Fatal: true}
	}
	msg := s.rejectMsg
	if msg == "" {
		msg = "محدوده زمانی سفارش معتبر نمی‌باشد!"
	}
	return Result{Detail: msg}
}

func fireConfig(mode string) Config {
	cfg := baseConfig()
	cfg.FireMode = mode
	cfg.RetryGapMs = MinGapMs
	cfg.MaxDurationS = 5
	return cfg
}

func newArmedEngine() *Engine {
	e := NewEngine()
	e.cancel = make(chan struct{})
	return e
}

// حالت «تعداد مشخص»: باید دقیقاً همان تعداد ارسال شود.
func TestFireCountModeSendsExactly(t *testing.T) {
	engine := newArmedEngine()
	sender := &stubSender{}
	cfg := fireConfig(FireCount)
	cfg.Retries = 7

	accepted, _ := engine.fire(cfg, LocalClock(), sender, time.Now())
	if accepted {
		t.Error("هیچ ارسالی پذیرفته نشده بود")
	}
	if got := atomic.LoadInt64(&sender.sent); got != 7 {
		t.Errorf("تعداد ارسال: %d، انتظار ۷", got)
	}
	if engine.Snapshot().Attempts != 7 {
		t.Errorf("شمارندهٔ رابط کاربری: %d", engine.Snapshot().Attempts)
	}
}

// حالت پیوسته: تا وقتی متوقف نکنیم ادامه می‌دهد.
func TestFireUntilStopKeepsGoingUntilCancelled(t *testing.T) {
	engine := newArmedEngine()
	sender := &stubSender{}
	cfg := fireConfig(FireUntilStop)

	go func() {
		time.Sleep(400 * time.Millisecond)
		engine.Cancel()
	}()
	started := time.Now()
	engine.fire(cfg, LocalClock(), sender, time.Now())

	sent := atomic.LoadInt64(&sender.sent)
	if sent < 5 {
		t.Errorf("در ۴۰۰ میلی‌ثانیه فقط %d ارسال شد؛ باید پیوسته می‌فرستاد", sent)
	}
	if time.Since(started) > 2*time.Second {
		t.Error("بعد از توقف، حلقه باید فوراً تمام شود")
	}
}

// با پذیرش سفارش باید فوراً بایستد.
func TestFireStopsOnAccepted(t *testing.T) {
	engine := newArmedEngine()
	sender := &stubSender{acceptAt: 3}

	accepted, summary := engine.fire(fireConfig(FireUntilStop), LocalClock(), sender, time.Now())
	if !accepted {
		t.Fatal("باید پذیرفته می‌شد")
	}
	if got := atomic.LoadInt64(&sender.sent); got != 3 {
		t.Errorf("بعد از پذیرش نباید ادامه می‌داد: %d ارسال", got)
	}
	if summary == "" {
		t.Error("خلاصهٔ نتیجه خالی است")
	}
}

// خطای احراز هویت تکرارپذیر نیست؛ باید فوراً بایستد.
func TestFireStopsOnFatalError(t *testing.T) {
	engine := newArmedEngine()
	sender := &stubSender{fatalAt: 2}

	accepted, _ := engine.fire(fireConfig(FireUntilStop), LocalClock(), sender, time.Now())
	if accepted {
		t.Error("نباید پذیرفته می‌شد")
	}
	if got := atomic.LoadInt64(&sender.sent); got != 2 {
		t.Errorf("بعد از خطای قطعی نباید ادامه می‌داد: %d ارسال", got)
	}
}

// سقف مدت، حلقهٔ پیوسته را حتی بدون توقف دستی می‌بندد.
func TestFireRespectsMaxDuration(t *testing.T) {
	engine := newArmedEngine()
	sender := &stubSender{}
	cfg := fireConfig(FireUntilStop)
	cfg.MaxDurationS = 1

	started := time.Now()
	engine.fire(cfg, LocalClock(), sender, time.Now())
	if elapsed := time.Since(started); elapsed > 3*time.Second {
		t.Errorf("سقف مدت رعایت نشد: %v", elapsed)
	}
}

// فاصلهٔ خیلی کم یعنی کوبیدن به سرور کارگزار.
func TestGapBelowMinimumIsRejected(t *testing.T) {
	cfg := baseConfig()
	cfg.FireMode = FireUntilStop
	cfg.RetryGapMs = 1
	if !hasProblem(cfg.Validate(bandLimits()), "فاصله") {
		t.Error("فاصلهٔ کمتر از حد مجاز باید رد شود")
	}
}

func TestCountModeValidatesNumber(t *testing.T) {
	cfg := baseConfig()
	cfg.FireMode = FireCount
	cfg.RetryGapMs = 50
	cfg.Retries = 0
	if !hasProblem(cfg.Validate(bandLimits()), "تعداد ارسال") {
		t.Error("تعداد صفر باید رد شود")
	}
	cfg.Retries = 200
	if hasProblem(cfg.Validate(bandLimits()), "تعداد ارسال") {
		t.Errorf("۲۰۰ ارسال باید مجاز باشد: %v", cfg.Validate(bandLimits()))
	}
}

var _ = fmt.Sprintf
