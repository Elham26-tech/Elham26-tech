package main

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestJwtExpiry(t *testing.T) {
	expires := time.Now().Add(90 * time.Minute).Unix()
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"exp":` + itoa64(expires) + `}`))
	token := "header." + payload + ".signature"

	got, ok := jwtExpiry(token)
	if !ok || got.Unix() != expires {
		t.Fatalf("انقضا خوانده نشد: %v %v", got, ok)
	}
	if _, ok := jwtExpiry("not-a-jwt"); ok {
		t.Error("رشتهٔ نامعتبر نباید انقضا بدهد")
	}
}

func TestExtractSymbolsFindsIsinAnywhere(t *testing.T) {
	raw := json.RawMessage(`{"result":{"items":[
		{"instrumentId":"IRO1FOLD0001","lVal18AFC":"فولاد","lVal30":"فولاد مبارکه اصفهان"},
		{"instrumentId":"IRO1TBAN0001","lVal18AFC":"وتجارت","lVal30":"بانک تجارت"}]}}`)
	hits := extractSymbols(raw)
	if len(hits) != 2 {
		t.Fatalf("تعداد نتایج: %d", len(hits))
	}
	if hits[0].ISIN != "IRO1FOLD0001" || hits[0].Symbol != "فولاد" {
		t.Errorf("نتیجهٔ اول اشتباه: %+v", hits[0])
	}
	if hits[1].Name != "بانک تجارت" {
		t.Errorf("نام شرکت خوانده نشد: %+v", hits[1])
	}
}

func TestExtractSymbolsIgnoresNonInstruments(t *testing.T) {
	if hits := extractSymbols(json.RawMessage(`{"ok":true,"count":0}`)); len(hits) != 0 {
		t.Errorf("نباید نمادی پیدا می‌شد: %v", hits)
	}
}

func TestPickNumberPrefersSpecificKeys(t *testing.T) {
	fields := map[string]float64{
		"maxAllowedPrice": 5592, "minAllowedPrice": 5268,
		"closingPrice": 5430, "maxQuantityPerOrder": 100000,
	}
	if got := pickNumber(fields, upperPatterns); got != 5592 {
		t.Errorf("سقف: %v", got)
	}
	if got := pickNumber(fields, lowerPatterns); got != 5268 {
		t.Errorf("کف: %v", got)
	}
	if got := pickNumber(fields, lastPricePatterns); got != 5430 {
		t.Errorf("آخرین قیمت: %v", got)
	}
	if got := pickNumber(fields, maxQuantityPatterns); got != 100000 {
		t.Errorf("سقف حجم: %v", got)
	}
}

func TestNumbersByKeyFlattensNestedJSON(t *testing.T) {
	fields := numbersByKey(json.RawMessage(`{"data":{"price":{"maxAllowedPrice":"5592"},"volume":12}}`))
	if fields["maxAllowedPrice"] != 5592 {
		t.Errorf("عدد رشته‌ای تبدیل نشد: %v", fields)
	}
	if fields["volume"] != 12 {
		t.Errorf("عدد تودرتو پیدا نشد: %v", fields)
	}
}

func TestEndpointWithReplacesTheRightParam(t *testing.T) {
	endpoint := Endpoint{Method: "GET", URL: "https://api.example.com/x?isin=IRO1TBAN0001&page=1", Param: "isin"}
	target, _, ok := endpoint.With("IRO1FOLD0001")
	if !ok || !strings.Contains(target, "isin=IRO1FOLD0001") || !strings.Contains(target, "page=1") {
		t.Errorf("جایگزینی اشتباه: %s (%v)", target, ok)
	}
}

func TestEndpointWithReplacesJSONField(t *testing.T) {
	endpoint := Endpoint{Method: "POST", URL: "https://api.example.com/search",
		Param: "term", InBody: true, PostData: `{"term":"فول","take":20}`}
	_, body, ok := endpoint.With("وتج")
	if !ok || !strings.Contains(body, `"term":"وتج"`) || !strings.Contains(body, `"take":20`) {
		t.Errorf("بدنهٔ جایگزین‌شده اشتباه: %s (%v)", body, ok)
	}
}

func TestBuildEndpointFindsSearchTermParam(t *testing.T) {
	// نام پارامتر ناآشناست؛ باید از روی *شکل مقدار* پیدا شود.
	endpoint, ok := buildEndpoint("GET", "https://api.example.com/inst/filter?zz=فول&take=20", "", false)
	if !ok || endpoint.Param != "zz" {
		t.Errorf("پارامتر عبارت جست‌وجو: %q (%v)", endpoint.Param, ok)
	}
}

func TestBuildEndpointFindsISINParam(t *testing.T) {
	endpoint, ok := buildEndpoint("GET", "https://api.example.com/q?code=IRO1TBAN0001", "", true)
	if !ok || endpoint.Param != "code" {
		t.Errorf("پارامتر ISIN: %q (%v)", endpoint.Param, ok)
	}
}

func TestLooksLikeSearchTerm(t *testing.T) {
	for _, good := range []string{"فول", "وتجارت", "fol"} {
		if !looksLikeSearchTerm(good) {
			t.Errorf("%q باید عبارت جست‌وجو باشد", good)
		}
	}
	for _, bad := range []string{"", "20", "1.5", "IRO1TBAN0001", "true", "عبارتی که خیلی طولانی است"} {
		if looksLikeSearchTerm(bad) {
			t.Errorf("%q نباید عبارت جست‌وجو باشد", bad)
		}
	}
}

func TestLooksLikeOrderBody(t *testing.T) {
	if !looksLikeOrderBody(`{"isin":"IR1","price":100,"quantity":5,"side":1}`) {
		t.Error("بدنهٔ سفارش تشخیص داده نشد")
	}
	if looksLikeOrderBody(`{"isin":"IR1","from":"2026-01-01"}`) {
		t.Error("بدنهٔ بدون قیمت و حجم نباید سفارش باشد")
	}
	if looksLikeOrderBody("not json") {
		t.Error("متن غیر JSON نباید سفارش باشد")
	}
}

func TestLearnedFillsConfig(t *testing.T) {
	c := NewCapturer()
	c.record("r1", "POST", "https://api.example.com/orders", map[string]string{"authorization": "Bearer tok"},
		`{"isin":"IR1","price":1,"quantity":2,"side":1}`)

	cfg := c.Learned(DefaultConfig())
	if cfg.BaseURL != "https://api.example.com" || cfg.OrderPath != "/orders" || cfg.Token != "tok" {
		t.Errorf("تنظیمات یادگرفته‌شده اعمال نشد: %+v", cfg)
	}
	if !strings.Contains(cfg.PayloadTemplate, "{price}") {
		t.Errorf("قالب بدنه ساخته نشد: %s", cfg.PayloadTemplate)
	}
}

func TestHintGuidesTheUser(t *testing.T) {
	c := NewCapturer()
	if !strings.Contains(c.Status().Hint, "باز کردن") {
		t.Error("راهنمای اول باید باز کردن ایزی‌تریدر باشد")
	}
	c.record("r1", "GET", "https://api.example.com/x", map[string]string{"authorization": "Bearer t"}, "")
	if !strings.Contains(c.Status().Hint, "جست‌وجو") {
		t.Errorf("راهنمای بعدی اشتباه: %s", c.Status().Hint)
	}
}

func itoa64(n int64) string {
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

func TestHumanDuration(t *testing.T) {
	cases := []struct {
		d    time.Duration
		want string
	}{
		{-time.Minute, "منقضی شده"},
		{45 * time.Minute, "45 دقیقه"},
		{5 * time.Hour, "5 ساعت"},
		{50 * time.Hour, "2 روز"},
	}
	for _, c := range cases {
		if got := humanDuration(c.d); got != c.want {
			t.Errorf("humanDuration(%v) = %s، انتظار %s", c.d, got, c.want)
		}
	}
}

func TestRequestsAreDeduplicatedByPath(t *testing.T) {
	c := NewCapturer()
	for i := 0; i < 40; i++ {
		c.record("t"+itoa64(int64(i)), "GET", "https://api.example.com/gw/tick?t="+itoa64(int64(i)), nil, "")
	}
	c.record("x", "GET", "https://api.example.com/gw/q?srch=فول", nil, "")

	requests := c.Requests()
	if len(requests) != 2 {
		t.Fatalf("باید فقط دو مسیر یکتا بماند، نه %d", len(requests))
	}
	if requests[0].Path != "/gw/q" {
		t.Errorf("تازه‌ترین باید اول باشد: %s", requests[0].Path)
	}
}

func TestSymbolTableFromInstrumentList(t *testing.T) {
	c := NewCapturer()
	c.record("r1", "GET", "https://api.example.com/gw/bootstrap", nil, "")

	var items []string
	for i := 0; i < 12; i++ {
		items = append(items, `{"id":`+itoa64(int64(40000+i))+`,"symbolName":"نماد`+itoa64(int64(i))+`"}`)
	}
	items = append(items, `{"id":41302,"symbolName":"تابان","companyName":"گروه پتروشیمی تابان فردا"}`)
	c.classifyResponse("r1", `{"items":[`+strings.Join(items, ",")+`]}`)

	status := c.Status()
	if !status.CanSearch {
		t.Error("با داشتن جدول نمادها، جست‌وجو باید ممکن باشد")
	}
	if status.SymbolCount != 13 {
		t.Errorf("تعداد نمادها: %d", status.SymbolCount)
	}

	hits := c.LocalSearch("تاب")
	if len(hits) != 1 || hits[0].Symbol != "تابان" {
		t.Errorf("جست‌وجوی محلی: %+v", hits)
	}
}

func TestLocalSearchNormalizesPersianSpelling(t *testing.T) {
	c := NewCapturer()
	c.LoadSymbols([]SymbolHit{{ISIN: "1", Symbol: "کیمیا"}, {ISIN: "2", Symbol: "وبملت"}})

	// همان کلمه با «ک» و «ی» عربی
	if hits := c.LocalSearch("كيميا"); len(hits) != 1 {
		t.Errorf("املای عربی باید همان نماد را بدهد: %+v", hits)
	}
}

func TestLocalSearchPrefersPrefixMatches(t *testing.T) {
	c := NewCapturer()
	c.LoadSymbols([]SymbolHit{
		{ISIN: "1", Symbol: "وهور", Name: "گروه س.انرژی امید تابان هور"},
		{ISIN: "2", Symbol: "تابان"},
		{ISIN: "3", Symbol: "تابا"},
	})
	hits := c.LocalSearch("تاب")
	if len(hits) != 3 {
		t.Fatalf("تعداد: %d", len(hits))
	}
	if hits[0].Symbol != "تابا" || hits[2].Symbol != "وهور" {
		t.Errorf("ترتیب اشتباه: %+v", hits)
	}
}
