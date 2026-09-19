package main

import (
	"strings"
	"testing"
)

func baseConfig() Config {
	cfg := DefaultConfig()
	cfg.Symbol = "فولاد"
	cfg.ISIN = "IRO1FOLD0001"
	cfg.Quantity = 1000
	cfg.FireMode = FireUntilStop
	cfg.RetryGapMs = 120
	cfg.MaxDurationS = 60
	cfg.BaseURL = "https://api.example.com"
	cfg.OrderPath = "/orders"
	cfg.OrderURL = "https://api.example.com/orders"
	cfg.PayloadTemplate = `{"isin":"{isin}","price":{price},"quantity":{quantity},"side":{side}}`
	cfg.Token = "token"
	return cfg
}

func bandLimits() Limits {
	return Limits{UpperPrice: 5592, LowerPrice: 5268, LastPrice: 5430, MaxQuantity: 100000}
}

func TestResolvePriceUsesBrokerLimits(t *testing.T) {
	cfg := baseConfig()
	if price, err := cfg.ResolvePrice(bandLimits()); err != nil || price != 5592 {
		t.Errorf("سقف: %d خطا=%v", price, err)
	}
	cfg.PriceMode = PriceLowerBand
	if price, _ := cfg.ResolvePrice(bandLimits()); price != 5268 {
		t.Errorf("کف: %d", price)
	}
	cfg.PriceMode = PriceLimit
	cfg.LimitPrice = 5400
	if price, _ := cfg.ResolvePrice(bandLimits()); price != 5400 {
		t.Errorf("دستی: %d", price)
	}
}

func TestResolvePriceNeedsLimitsFromBroker(t *testing.T) {
	if _, err := baseConfig().ResolvePrice(Limits{}); err == nil {
		t.Error("بدون سقف کارگزاری باید خطا بدهد")
	}
}

func TestValidateAcceptsHealthyOrder(t *testing.T) {
	if problems := baseConfig().Validate(bandLimits()); len(problems) != 0 {
		t.Errorf("سفارش سالم رد شد: %v", problems)
	}
}

func TestValidateCatchesMissingSymbol(t *testing.T) {
	cfg := baseConfig()
	cfg.ISIN = ""
	if !hasProblem(cfg.Validate(bandLimits()), "نماد") {
		t.Error("نبود نماد باید ایراد باشد")
	}
}

func TestValidateCatchesQuantityAboveBrokerCap(t *testing.T) {
	cfg := baseConfig()
	cfg.Quantity = 500_000
	if !hasProblem(cfg.Validate(bandLimits()), "سقف کارگزاری") {
		t.Error("سقف حجم کارگزاری اعمال نشد")
	}
}

func TestValidateChecksManualPriceAgainstBand(t *testing.T) {
	cfg := baseConfig()
	cfg.PriceMode = PriceLimit
	cfg.LimitPrice = 9999
	if !hasProblem(cfg.Validate(bandLimits()), "سقف مجاز") {
		t.Error("قیمت دستی بالاتر از سقف باید رد شود")
	}
	cfg.LimitPrice = 100
	if !hasProblem(cfg.Validate(bandLimits()), "کف مجاز") {
		t.Error("قیمت دستی پایین‌تر از کف باید رد شود")
	}
}

func TestValidateCatchesBadTargetTime(t *testing.T) {
	cfg := baseConfig()
	cfg.TargetHour = 25
	if !hasProblem(cfg.Validate(bandLimits()), "ساعت هدف") {
		t.Error("ساعت ۲۵ باید رد شود")
	}
}

func TestValidateRequiresLearnedApiSettings(t *testing.T) {
	cfg := baseConfig()
	cfg.OrderPath, cfg.OrderURL = "", ""
	cfg.Token = ""
	problems := cfg.Validate(bandLimits())
	if !hasProblem(problems, "مسیر ثبت سفارش") || !hasProblem(problems, "توکن") {
		t.Errorf("نبودِ تنظیمات یادگرفته‌شده باید ایراد باشد: %v", problems)
	}
}

func TestTargetTimeText(t *testing.T) {
	cfg := baseConfig()
	cfg.TargetHour, cfg.TargetMinute, cfg.TargetSecond, cfg.TargetMillis = 8, 30, 5, 250
	if got := cfg.TargetTimeText(); got != "08:30:05.250" {
		t.Errorf("نمایش ساعت: %s", got)
	}
}

func TestComma(t *testing.T) {
	for input, want := range map[int64]string{0: "0", 999: "999", 1000: "1,000", 5592000: "5,592,000", -1234: "-1,234"} {
		if got := comma(input); got != want {
			t.Errorf("comma(%d) = %s، انتظار %s", input, got, want)
		}
	}
}

func hasProblem(problems []string, needle string) bool {
	for _, problem := range problems {
		if strings.Contains(problem, needle) {
			return true
		}
	}
	return false
}
