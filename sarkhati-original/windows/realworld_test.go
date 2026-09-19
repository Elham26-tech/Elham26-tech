package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// این تست‌ها از روی گزارش تشخیصی واقعی ایزی‌تریدر مفید نوشته شده‌اند، نه حدس.

// شکل واقعی پاسخ اطلاعات نماد در مفید.
const mofidSymbolInfo = `{"symbolISIN":"IRO1TBAN0001","totalNumberOfTrades":19781,
	"closingPrice":16650,"highPrice":16650,"lowPrice":16650,"lastTradedPrice":16650,
	"priceVar":2.97,"feeOfPreviousDaysClosingPrice":16170,
	"highAllowedPrice":16650,"lowAllowedPrice":15690,
	"maxQuantityPerOrder":200000,"tickSize":10}`

func TestMofidInstrumentLimits(t *testing.T) {
	fields := numbersByKey(json.RawMessage(mofidSymbolInfo))
	if got := pickNumber(fields, upperPatterns); got != 16650 {
		t.Errorf("سقف مجاز: %v", got)
	}
	if got := pickNumber(fields, lowerPatterns); got != 15690 {
		t.Errorf("کف مجاز: %v", got)
	}
	if got := pickNumber(fields, maxQuantityPatterns); got != 200000 {
		t.Errorf("سقف حجم: %v", got)
	}
	if got := pickNumber(fields, tickPatterns); got != 10 {
		t.Errorf("گام قیمت: %v", got)
	}
	if !hasBandNumbers(mofidSymbolInfo) {
		t.Error("این پاسخ باید به‌عنوان اطلاعات نماد شناخته شود")
	}
}

func TestMofidInstrumentRequestIsLearned(t *testing.T) {
	c := NewCapturer()
	c.record("r1", "POST", "https://api-mts.orbis.easytrader.ir/symbols/api/MarketData/symbol-info-data",
		map[string]string{"authorization": "Bearer a.b.c"}, `{"isin":"IRO1TBAN0001"}`)
	c.classifyResponse("r1", mofidSymbolInfo)

	if !c.Status().CanQuote {
		t.Fatal("درخواست اطلاعات نماد یاد گرفته نشد")
	}
	// باید بتواند همان درخواست را با نماد دیگری تکرار کند.
	endpoint := c.endpointOf("instrument")
	_, body, ok := endpoint.With("IRO1FOLD0001")
	if !ok || !strings.Contains(body, "IRO1FOLD0001") {
		t.Errorf("جایگزینی نماد در بدنه: %s (%v)", body, ok)
	}
}

// جست‌وجوی ایزی‌تریدر سمت مرورگر است؛ تنها چیزی که به سرور می‌رود آمار است.
// این درخواست نباید به‌عنوان «مسیر جست‌وجو» یاد گرفته شود.
func TestSearchAnalyticsIsNotLearnedAsSearch(t *testing.T) {
	c := NewCapturer()
	c.record("r1", "POST", "https://api-mts.orbis.easytrader.ir/user-engagement/api/v3/SearchQueryV3",
		nil, `{"pairs":[{"query":"تابان","selectedItem":"تابان"}],"appType":1,"deviceType":2}`)
	c.classifyResponse("r1", `{"ok":true}`)

	if c.endpointOf("search") != nil {
		t.Error("درخواست آمار نباید به‌جای جست‌وجو گرفته شود")
	}
}

// فهرست کل نمادها با یک هشِ کش گرفته می‌شود؛ باید از روی مسیر شناخته شود.
func TestSymbolListRequestIsDetected(t *testing.T) {
	c := NewCapturer()
	c.record("r1", "POST", "https://api-mts.orbis.easytrader.ir/symbols/api/symbols/all",
		map[string]string{"authorization": "Bearer a.b.c"}, `{"hash":"DXMUX0OMtvCE8NtjHpB5pw%3d%3d"}`)

	status := c.Status()
	if !status.CanListSymbols {
		t.Fatal("درخواست فهرست نمادها شناخته نشد")
	}
	if !strings.Contains(status.Hint, "فهرست نمادها") {
		t.Errorf("راهنما باید به گرفتن فهرست اشاره کند: %s", status.Hint)
	}
}

func TestClearCacheFieldsForcesFullList(t *testing.T) {
	got := clearCacheFields(`{"hash":"DXMUX0OMtvCE8NtjHpB5pw%3d%3d","take":50}`)
	if !strings.Contains(got, `"hash":""`) {
		t.Errorf("هش خالی نشد: %s", got)
	}
	if !strings.Contains(got, `"take":50`) {
		t.Errorf("بقیهٔ فیلدها باید دست‌نخورده بمانند: %s", got)
	}
}

func TestClearCacheParamsForcesFullList(t *testing.T) {
	got := clearCacheParams("https://api.example.com/all?etag=abc&take=50")
	if !strings.Contains(got, "etag=&") && !strings.HasSuffix(got, "etag=") {
		t.Errorf("پارامتر کش خالی نشد: %s", got)
	}
	if !strings.Contains(got, "take=50") {
		t.Errorf("پارامتر دیگر باید بماند: %s", got)
	}
}

// شکل واقعی فهرست نمادها در مفید (بر اساس نام‌های میدانی همان API).
func TestSymbolsFromMofidList(t *testing.T) {
	raw := json.RawMessage(`{"result":[
		{"symbolIsin":"IRO1TBAN0001","symbolTitle":"وتجارت","companyTitle":"بانک تجارت"},
		{"symbolIsin":"IRO1TABA0001","symbolTitle":"تابان","companyTitle":"گروه پتروشیمی تابان فردا"}]}`)
	hits := extractSymbols(raw)
	if len(hits) != 2 {
		t.Fatalf("تعداد نمادها: %d", len(hits))
	}
	if hits[0].Symbol != "وتجارت" || hits[0].ISIN != "IRO1TBAN0001" || hits[0].Name != "بانک تجارت" {
		t.Errorf("نماد اول: %+v", hits[0])
	}
}

// اگر کلیدها نام آشنا نداشته باشند، از روی طول متن تشخیص داده می‌شود.
func TestSymbolsFromCrypticKeys(t *testing.T) {
	raw := json.RawMessage(`{"d":[{"i":"IRO1TBAN0001","a":"وتجارت","b":"بانک تجارت ایران"}]}`)
	hits := extractSymbols(raw)
	if len(hits) != 1 {
		t.Fatalf("تعداد: %d", len(hits))
	}
	if hits[0].Symbol != "وتجارت" || hits[0].Name != "بانک تجارت ایران" {
		t.Errorf("تشخیص از روی طول متن کار نکرد: %+v", hits[0])
	}
}

// دیده‌بان فقط کد نماد دارد بدون نام؛ نباید نمادِ بی‌نام وارد جدول شود.
func TestWatchlistWithoutNamesIsIgnored(t *testing.T) {
	raw := json.RawMessage(`[{"name":"مفید","watchCategorySymbols":[
		{"symbolIsin":"IRT3SATF0001"},{"symbolIsin":"IRT1ARAM0001"}]}]`)
	if hits := extractSymbols(raw); len(hits) != 0 {
		t.Errorf("نماد بدون نام نباید وارد جدول شود: %+v", hits)
	}
}

// شاخص‌های بورس (ISIN با IRX) نباید وارد جدول نمادها شوند: نه قابل معامله‌اند
// و نه باید جدول را «پر» نشان بدهند و جلوی گرفتن فهرست کامل را بگیرند.
func TestIndicesAreNotTreatedAsSymbols(t *testing.T) {
	c := NewCapturer()
	c.record("r1", "GET", "https://api-mts.orbis.easytrader.ir/symbols/api/MarketData/tse-index", nil, "")
	c.classifyResponse("r1", `[{"symbolIsin":"IRX6XS300006","symbolTitle":"شاخص 30 شركت بزرگ","lastIndexValue":540035},
		{"symbolIsin":"IRXZXOSY0006","symbolTitle":"شاخص كل","lastIndexValue":308678}]`)

	if count := c.Status().SymbolCount; count != 0 {
		t.Errorf("شاخص‌ها نباید در جدول باشند، ولی %d تا هست", count)
	}
}

// چند نماد پراکنده نباید جلوی گرفتن فهرست کامل را بگیرد.
func TestPartialTableStillNeedsFullList(t *testing.T) {
	c := NewCapturer()
	c.record("r1", "POST", "https://api-mts.orbis.easytrader.ir/symbols/api/symbols/all",
		map[string]string{"authorization": "Bearer a.b.c"}, `{"hash":"abc"}`)
	c.LoadSymbols([]SymbolHit{{ISIN: "IRO1TBAN0001", Symbol: "وتجارت"}})

	status := c.Status()
	if status.SymbolsFull {
		t.Error("با یک نماد، فهرست کامل به حساب نمی‌آید")
	}
	if !status.CanListSymbols {
		t.Error("درخواست فهرست باید در دسترس بماند")
	}

	c.MarkFullList()
	if !c.Status().SymbolsFull {
		t.Error("بعد از گرفتن فهرست کامل باید علامت بخورد")
	}
}

// پرس‌وجوی GraphQL مفید: کد نماد داخل متن است، نه یک فیلد جدا.
func TestGraphQLInstrumentEndpointIsUsable(t *testing.T) {
	body := `{"query":"query {marketData(request: { isins: \"IRO1TBAN0001\"}) ` +
		`{symbolIsin lowAllowedPrice highAllowedPrice}}"}`
	endpoint, ok := buildEndpoint("POST",
		"https://api-mts.orbis.easytrader.ir/symbols/api/marketdata", body, true)
	if !ok {
		t.Fatal("کد نماد داخل متن پیدا نشد")
	}
	_, replaced, ok := endpoint.With("IRO5GLPA0001")
	if !ok || !strings.Contains(replaced, "IRO5GLPA0001") || strings.Contains(replaced, "IRO1TBAN0001") {
		t.Errorf("جایگزینی داخل متن: %s (%v)", replaced, ok)
	}
	if !strings.Contains(replaced, "highAllowedPrice") {
		t.Errorf("بقیهٔ پرس‌وجو باید دست‌نخورده بماند: %s", replaced)
	}
}

// هیچ پاسخی همهٔ اعداد را ندارد؛ باید از چند منبع ترکیب شوند.
func TestLimitsMergeFromSeveralSources(t *testing.T) {
	limits := Limits{Fields: map[string]float64{}}
	mergeLimits(&limits, map[string]float64{"highAllowedPrice": 4530, "lowAllowedPrice": 4270})
	mergeLimits(&limits, map[string]float64{"maxQuantityPerOrder": 300000, "tickSize": 10})

	if limits.UpperPrice != 4530 || limits.LowerPrice != 4270 {
		t.Errorf("سقف و کف: %+v", limits)
	}
	if limits.MaxQuantity != 300000 {
		t.Errorf("حداکثر تعداد مجاز از منبع دوم نیامد: %+v", limits)
	}
	if limits.Tick != 10 {
		t.Errorf("گام قیمت: %+v", limits)
	}
}

// مسیر سفارشی که فقط «مسیر» است و نشانی کامل ندارد، یادگاریِ نسخه‌های قدیمی
// برنامه است و واقعاً یاد گرفته نشده. اگر آن را معتبر بدانیم، سفارش به نشانی
// اشتباه می‌رود و HTTP 404 می‌گیرد در حالی که رابط می‌گوید همه‌چیز آماده است.
func TestSeededOrderPathWithoutFullURLIsNotLearned(t *testing.T) {
	c := NewCapturer()
	c.Seed(nil, nil, "", "/easy/api/OmsOrder/Post",
		`{"isin":"{isin}","price":{price},"quantity":{quantity},"side":{side}}`,
		"https://api-mts.orbis.easytrader.ir")

	status := c.Status()
	if status.CanOrder {
		t.Error("مسیر بدون نشانی کامل نباید «یادگرفته‌شده» حساب شود")
	}
	if status.Ready {
		t.Error("بدون مسیر واقعی سفارش، آماده نیستیم")
	}
}

func TestSeededOrderWithFullURLIsLearned(t *testing.T) {
	c := NewCapturer()
	c.record("r0", "GET", "https://api.example.com/x",
		map[string]string{"authorization": "Bearer a.b.c"}, "")
	c.Seed(nil, nil, "https://oms.example.com/v2/new", "/v2/new", `{"price":{price}}`,
		"https://api.example.com")

	if !c.Status().CanOrder {
		t.Error("سفارشِ دارای نشانی کامل باید یادگرفته‌شده باشد")
	}
}

func TestOrderRequiresLearnedURL(t *testing.T) {
	cfg := baseConfig()
	cfg.OrderURL = ""
	if !hasProblem(cfg.Validate(bandLimits()), "مسیر ثبت سفارش") {
		t.Error("بدون نشانی واقعی سفارش باید ایراد بگیرد")
	}
}

// خطای ۴۰۴ باید بگوید کاربر چه کار کند، نه فقط کد وضعیت.
func TestNotFoundErrorIsActionable(t *testing.T) {
	cfg := baseConfig()
	cfg.OrderURL = "https://api.example.com/easy/api/OmsOrder/Post"
	result := NewAPISender(cfg).interpret(404, "")
	if result.Accepted {
		t.Fatal("۴۰۴ نباید پذیرفته شود")
	}
	if !strings.Contains(result.Detail, "یک‌بار در ایزی‌تریدر سفارشی ثبت کنید") {
		t.Errorf("پیام راهنما ندارد: %s", result.Detail)
	}
}
