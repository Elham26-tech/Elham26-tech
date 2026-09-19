package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// بدنهٔ دقیقِ سفارش واقعی ایزی‌تریدر مفید، از گزارش تشخیصی کاربر.
const mofidOrderBody = `{"order":{"price":4530,"quantity":100000,"side":0,"validityType":0,
	"createDateTime":"9/14/2026, 12:40:44 AM","commission":0.003632,
	"symbolIsin":"IRO5GLPA0001","symbolName":"خگلپا","orderModelType":1,
	"totalValue":454645297,"orderFrom":34}}`

// بدنهٔ سفارش تودرتوست؛ نگاه کردن به سطح اول یعنی هیچ‌وقت شناخته نشدن.
func TestNestedOrderBodyIsRecognized(t *testing.T) {
	if !looksLikeOrderBody(mofidOrderBody) {
		t.Fatal("سفارش تودرتو شناخته نشد")
	}
	if looksLikeOrderBody(`{"wrapper":{"symbolIsin":"IRO5GLPA0001","from":"2026-01-01"}}`) {
		t.Error("بدنهٔ بدون قیمت و حجم نباید سفارش باشد")
	}
}

func TestOrderShapeFromMofidBody(t *testing.T) {
	shape, ok := BuildOrderShape(mofidOrderBody)
	if !ok {
		t.Fatal("قالب ساخته نشد")
	}
	if shape.SideSample != "0" {
		t.Errorf("کد سمتِ سفارش واقعی: %q", shape.SideSample)
	}
	if shape.Commission != 0.003632 {
		t.Errorf("کارمزد: %v", shape.Commission)
	}
	if shape.DateSample != "9/14/2026, 12:40:44 AM" {
		t.Errorf("نمونهٔ تاریخ: %q", shape.DateSample)
	}

	// ساختار تودرتو باید حفظ شود و فیلدهای ناشناخته دست‌نخورده بمانند.
	for _, want := range []string{`"order":{`, `"price":{price}`, `"quantity":{quantity}`,
		`"side":{side}`, `"symbolIsin":"{isin}"`, `"symbolName":"{symbol}"`,
		`"totalValue":{value}`, `"createDateTime":"{now}"`,
		`"commission":0.003632`, `"orderFrom":34`, `"orderModelType":1`, `"validityType":0`} {
		if !strings.Contains(shape.Template, want) {
			t.Errorf("قالب شامل %s نیست:\n%s", want, shape.Template)
		}
	}
}

// قالب پرشده باید JSON معتبر باشد و مقادیر درست داشته باشد.
func TestFilledOrderBodyIsValidJSON(t *testing.T) {
	shape, _ := BuildOrderShape(mofidOrderBody)

	cfg := baseConfig()
	cfg.PayloadTemplate = shape.Template
	cfg.OrderDateSample = shape.DateSample
	cfg.OrderCommission = shape.Commission
	cfg.SideBuy, cfg.SideSell = sideCodesFrom(shape.SideSample, false)
	cfg.Symbol, cfg.ISIN, cfg.Quantity = "خگلپا", "IRO5GLPA0001", 100000

	body := NewAPISender(cfg).BuildBody(4530)
	var parsed map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(body), &parsed); err != nil {
		t.Fatalf("بدنهٔ ساخته‌شده JSON معتبر نیست: %v\n%s", err, body)
	}
	order := parsed["order"]
	if order["price"] != float64(4530) || order["quantity"] != float64(100000) {
		t.Errorf("قیمت/حجم: %+v", order)
	}
	if order["side"] != float64(0) {
		t.Errorf("کد سمت خرید باید همان ۰ باشد: %+v", order["side"])
	}
	if order["symbolIsin"] != "IRO5GLPA0001" || order["symbolName"] != "خگلپا" {
		t.Errorf("نماد: %+v", order)
	}
	// ارزش کل با کارمزد: 4530 × 100000 × 1.003632
	if order["totalValue"] != float64(454645296) && order["totalValue"] != float64(454645297) {
		t.Errorf("ارزش کل: %v", order["totalValue"])
	}
	if date, _ := order["createDateTime"].(string); !jsLocaleDateRe.MatchString(date) {
		t.Errorf("تاریخ تازه ساخته نشد: %q", date)
	}
	if order["commission"] != 0.003632 || order["orderFrom"] != float64(34) {
		t.Errorf("فیلدهای ثابت تغییر کرده‌اند: %+v", order)
	}
}

func TestSideCodesFromCapturedOrder(t *testing.T) {
	buy, sell := sideCodesFrom("0", false)
	if buy != "0" || sell != "1" {
		t.Errorf("کد سمت از ۰: خرید=%s فروش=%s", buy, sell)
	}
	buy, sell = sideCodesFrom("0", true) // همان سفارش اگر فروش بوده باشد
	if buy != "1" || sell != "0" {
		t.Errorf("وقتی سفارشِ دیده‌شده فروش بوده: خرید=%s فروش=%s", buy, sell)
	}
}

func TestFormatLikeSample(t *testing.T) {
	now := time.Date(2026, 3, 10, 14, 5, 9, 0, time.UTC)
	if got := formatLikeSample("9/14/2026, 12:40:44 AM", now); got != "3/10/2026, 2:05:09 PM" {
		t.Errorf("شکل مرورگری: %q", got)
	}
	if got := formatLikeSample("2026-09-14T00:40:44Z", now); got != "2026-03-10T14:05:09Z" {
		t.Errorf("شکل ISO: %q", got)
	}
	// شکل ناشناخته را دست نمی‌زنیم.
	if got := formatLikeSample("۱۴۰۵/۰۶/۲۳", now); got != "۱۴۰۵/۰۶/۲۳" {
		t.Errorf("شکل ناشناخته نباید عوض شود: %q", got)
	}
}

func TestOrderTotalValue(t *testing.T) {
	if got := orderTotalValue(4530, 100000, 0.003632); got != 454645296 {
		t.Errorf("ارزش کل با کارمزد: %d", got)
	}
	if got := orderTotalValue(1000, 10, 0); got != 10000 {
		t.Errorf("بدون کارمزد: %d", got)
	}
}
