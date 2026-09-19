package main

import (
	"testing"
	"time"
)

func TestNextOccurrenceRollsForwardWhenPast(t *testing.T) {
	loc := Tehran()
	now := time.Date(2026, 3, 10, 9, 0, 0, 0, loc)
	target := NextOccurrenceAt(now, 8, 30, 0, 0)
	if !target.After(now) {
		t.Error("لحظهٔ هدف باید در آینده باشد")
	}
	if target.In(loc).Day() != 11 {
		t.Errorf("باید به فردا منتقل شود، روز: %d", target.In(loc).Day())
	}
}

func TestNextOccurrenceKeepsMilliseconds(t *testing.T) {
	loc := Tehran()
	now := time.Date(2026, 3, 10, 7, 0, 0, 0, loc)
	target := NextOccurrenceAt(now, 8, 30, 5, 250)
	if got := target.In(loc).Format("15:04:05.000"); got != "08:30:05.250" {
		t.Errorf("لحظهٔ هدف: %s", got)
	}
}

func TestNextOccurrenceSameDay(t *testing.T) {
	loc := Tehran()
	now := time.Date(2026, 3, 10, 7, 0, 0, 0, loc)
	target := NextOccurrenceAt(now, 8, 30, 0, 0)
	if target.In(loc).Day() != 10 || target.In(loc).Hour() != 8 {
		t.Errorf("لحظهٔ هدف اشتباه: %v", target.In(loc))
	}
}

func TestWaitUntilIsSubMillisecond(t *testing.T) {
	engine := NewEngine()
	engine.cancel = make(chan struct{})
	clock := LocalClock()
	target := clock.Now().Add(120 * time.Millisecond)

	if !engine.waitUntil(clock, target, false) {
		t.Fatal("انتظار نباید لغو می‌شد")
	}
	drift := clock.Now().Sub(target)
	if drift < 0 {
		t.Errorf("زودتر از هدف بیدار شد: %v", drift)
	}
	if drift > time.Millisecond {
		t.Errorf("خطای زمانی %v بیش از یک میلی‌ثانیه است", drift)
	}
}

func TestWaitUntilRespectsCancel(t *testing.T) {
	engine := NewEngine()
	engine.cancel = make(chan struct{})
	clock := LocalClock()
	go func() {
		time.Sleep(50 * time.Millisecond)
		engine.Cancel()
	}()
	if engine.waitUntil(clock, clock.Now().Add(10*time.Second), false) {
		t.Error("لغو باید انتظار را قطع کند")
	}
}

func TestClockOffsetIsApplied(t *testing.T) {
	now := time.Now()
	clock := Clock{ServerAtAnchor: now.Add(2 * time.Second), Anchor: now}
	offset := clock.OffsetMillis()
	if offset < 1900 || offset > 2100 {
		t.Errorf("اختلاف ساعت %v میلی‌ثانیه، انتظار حدود ۲۰۰۰", offset)
	}
}
