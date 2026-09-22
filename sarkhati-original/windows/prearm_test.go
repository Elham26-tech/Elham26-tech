package main

import (
	"testing"
	"time"
)

// شلیک باید preArm ثانیه زودتر از ساعت هدف شروع شود — کارگزاری‌ها گاهی
// تا یک دقیقه زودتر باز می‌کنند و بدون این، آن پنجره از دست می‌رود.
func TestPreArmBringsFireForward(t *testing.T) {
	cfg := DefaultConfig()
	if cfg.PreArmSeconds != 60 {
		t.Fatalf("پیش‌فرض «شروع زودتر» باید ۶۰ ثانیه باشد، نه %d", cfg.PreArmSeconds)
	}

	target := time.Date(2026, 9, 23, 8, 45, 0, 0, time.UTC)
	lead := 120 * time.Millisecond

	for _, preArmSeconds := range []int{0, 20, 60} {
		preArm := time.Duration(preArmSeconds) * time.Second
		fireAt := target.Add(-lead - preArm)
		gap := target.Sub(fireAt)
		want := lead + preArm
		if gap != want {
			t.Errorf("با شروع زودترِ %d ثانیه، فاصله تا هدف %v شد نه %v", preArmSeconds, gap, want)
		}
	}
}

func TestPreArmValidated(t *testing.T) {
	limits := Limits{UpperPrice: 100, LowerPrice: 50}
	cfg := DefaultConfig()
	cfg.ISIN, cfg.Quantity, cfg.Mode = "IRO1FOLD0001", 10, "desktop"
	cfg.PriceMode = PriceUpperBand

	cfg.PreArmSeconds = 601
	if problems := cfg.Validate(limits); len(problems) == 0 {
		t.Error("«شروع زودتر» بیش از ۶۰۰ ثانیه باید رد شود")
	}
	cfg.PreArmSeconds = -1
	if problems := cfg.Validate(limits); len(problems) == 0 {
		t.Error("«شروع زودتر» منفی باید رد شود")
	}
	cfg.PreArmSeconds = 60
	for _, p := range cfg.Validate(limits) {
		if contains(p, "شروع زودتر") {
			t.Errorf("۶۰ ثانیه باید معتبر باشد، ولی: %s", p)
		}
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && (haystack == needle ||
		len(needle) == 0 || indexOf(haystack, needle) >= 0)
}

func indexOf(h, n string) int {
	for i := 0; i+len(n) <= len(h); i++ {
		if h[i:i+len(n)] == n {
			return i
		}
	}
	return -1
}
