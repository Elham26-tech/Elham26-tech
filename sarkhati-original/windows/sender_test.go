package main

import (
	"strings"
	"testing"
)

func TestBuildBodyFillsPlaceholders(t *testing.T) {
	cfg := baseConfig()
	cfg.PayloadTemplate = `{"isin":"{isin}","q":{quantity},"p":{price},"s":{side},"n":"{symbol}"}`
	sender := NewAPISender(cfg)
	body := sender.BuildBody(5592)

	for _, want := range []string{`"isin":"IRO1FOLD0001"`, `"q":1000`, `"p":5592`, `"s":1`, `"n":"فولاد"`} {
		if !strings.Contains(body, want) {
			t.Errorf("بدنه شامل %s نیست: %s", want, body)
		}
	}
}

func TestBuildBodyUsesSellCode(t *testing.T) {
	cfg := baseConfig()
	cfg.Side = "sell"
	if body := NewAPISender(cfg).BuildBody(1); !strings.Contains(body, `"side":2`) {
		t.Errorf("کد سمت فروش اشتباه است: %s", body)
	}
}

func TestBuildRequestIsWellFormed(t *testing.T) {
	cfg := baseConfig()
	cfg.Token = "secret"
	sender := NewAPISender(cfg)
	sender.host = "api.example.com"

	raw := string(sender.BuildRequest(5592))
	head, body, found := strings.Cut(raw, "\r\n\r\n")
	if !found {
		t.Fatal("سرآیند و بدنه جدا نشده‌اند")
	}
	if !strings.HasPrefix(head, "POST "+cfg.OrderPath+" HTTP/1.1") {
		t.Errorf("خط اول اشتباه: %s", head)
	}
	if !strings.Contains(head, "Host: api.example.com") {
		t.Error("هدر Host نیست")
	}
	if !strings.Contains(head, "Authorization: Bearer secret") {
		t.Error("هدر احراز هویت نیست")
	}
	if !strings.Contains(head, "Content-Length: "+itoa(len(body))) {
		t.Errorf("طول بدنه اشتباه است، بدنه %d بایت", len(body))
	}
}

func TestInterpretResponses(t *testing.T) {
	cfg := baseConfig()
	cfg.SuccessMarker = `"isSuccessful":true`
	sender := NewAPISender(cfg)

	if r := sender.interpret(200, `{"isSuccessful":true}`); !r.Accepted {
		t.Error("پاسخ موفق باید پذیرفته شود")
	}
	if r := sender.interpret(200, `{"isSuccessful":false}`); r.Accepted {
		t.Error("پاسخ ۲۰۰ بدون نشانهٔ موفقیت نباید پذیرفته شود")
	}
	if r := sender.interpret(401, `unauthorized`); r.Accepted {
		t.Error("پاسخ ۴۰۱ نباید پذیرفته شود")
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var digits []byte
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}

// سفارش باید به همان نشانی کاملی برود که یاد گرفته شده، نه ترکیب نشانی پایه
// و مسیر: مسیر سفارش ممکن است روی میزبان دیگری از همان کارگزاری باشد.
func TestOrderGoesToCapturedFullURL(t *testing.T) {
	cfg := baseConfig()
	cfg.BaseURL = "https://api-mts.orbis.easytrader.ir"
	cfg.OrderPath = "/easy/api/OmsOrder/Post"
	cfg.OrderURL = "https://oms.easytrader.ir/v2/orders/new"

	sender := NewAPISender(cfg)
	if got := sender.targetURL(); got != cfg.OrderURL {
		t.Errorf("نشانی سفارش: %s", got)
	}
	if got := sender.targetPath(); got != "/v2/orders/new" {
		t.Errorf("مسیر درخواست: %s", got)
	}
}

func TestOrderFallsBackToBaseURLWhenNoFullURL(t *testing.T) {
	cfg := baseConfig()
	cfg.BaseURL = "https://api.example.com"
	cfg.OrderPath = "/orders"
	if got := NewAPISender(cfg).targetPath(); got != "/orders" {
		t.Errorf("مسیر: %s", got)
	}
}

// کارگزار برای سفارشِ ردشده هم HTTP 200 می‌دهد و نتیجه را داخل بدنه می‌گوید.
// بدون خواندن بدنه، «رد شد» به‌اشتباه «پذیرفته» حساب می‌شود.
func TestRejectionInsideHTTP200IsNotAccepted(t *testing.T) {
	cfg := baseConfig()
	cfg.SuccessMarker = ""
	sender := NewAPISender(cfg)

	body := `{"isSuccessful":false,"id":"","message":"محدوده زمانی سفارش معتبر نمی‌باشد!","omsError":null}`
	result := sender.interpret(200, body)
	if result.Accepted {
		t.Fatal("سفارش ردشده نباید پذیرفته حساب شود")
	}
	if !strings.Contains(result.Detail, "محدوده زمانی سفارش") {
		t.Errorf("پیام خود کارگزار باید نشان داده شود: %s", result.Detail)
	}

	if ok := sender.interpret(200, `{"isSuccessful":true,"id":"123"}`); !ok.Accepted {
		t.Errorf("سفارش پذیرفته‌شده باید پذیرفته حساب شود: %s", ok.Detail)
	}
}

func TestPlainOKWithoutVerdictFieldIsAccepted(t *testing.T) {
	cfg := baseConfig()
	cfg.SuccessMarker = ""
	if !NewAPISender(cfg).interpret(200, `{"orderId":123}`).Accepted {
		t.Error("پاسخ ۲۰۰ بدون فیلد نتیجه، پذیرفته حساب می‌شود")
	}
}

func TestManualMarkerStillWins(t *testing.T) {
	cfg := baseConfig()
	cfg.SuccessMarker = `"ok":true`
	sender := NewAPISender(cfg)
	if !sender.interpret(200, `{"ok":true}`).Accepted {
		t.Error("نشانهٔ دستی باید کار کند")
	}
	if sender.interpret(200, `{"ok":false}`).Accepted {
		t.Error("بدون نشانه نباید پذیرفته شود")
	}
}
