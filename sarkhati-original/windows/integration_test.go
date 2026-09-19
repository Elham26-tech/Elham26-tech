package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// این تست یک «ایزی‌تریدر قلابی» بالا می‌آورد و با مرورگر واقعی بررسی می‌کند که
// لایهٔ یادگیری، توکن و هر سه درخواست کلیدی را درست برمی‌دارد و بعد می‌تواند
// خودش از همان مسیرها جست‌وجو و اطلاعات نماد بگیرد.

const fakePage = `<!doctype html><meta charset="utf-8"><title>fake</title><script>
const token = "header.eyJleHAiOjQxMDI0NDQ4MDB9.sig";
const auth = {"Authorization": "Bearer " + token, "Content-Type": "application/json"};
async function run() {
  await fetch("/api/search/instrument?q=" + encodeURIComponent("فول"), {headers: auth});
  await fetch("/api/ind-inst?isin=IRO1FOLD0001", {headers: auth});
  await fetch("/api/OmsOrder/Post", {method: "POST", headers: auth,
    body: JSON.stringify({isin: "IRO1FOLD0001", price: 5592, quantity: 1000, side: 1, validityType: 1})});
  document.title = "done";
}
run();
</script>`

func fakeBroker() *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(fakePage))
	})
	mux.HandleFunc("/api/search/instrument", func(w http.ResponseWriter, r *http.Request) {
		term := r.URL.Query().Get("q")
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(term, "وتج") {
			w.Write([]byte(`{"items":[{"instrumentId":"IRO1TBAN0001","lVal18AFC":"وتجارت","lVal30":"بانک تجارت"}]}`))
			return
		}
		w.Write([]byte(`{"items":[{"instrumentId":"IRO1FOLD0001","lVal18AFC":"فولاد","lVal30":"فولاد مبارکه"}]}`))
	})
	mux.HandleFunc("/api/ind-inst", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":{"maxAllowedPrice":5592,"minAllowedPrice":5268,
			"closingPrice":5430,"maxQuantityPerOrder":100000,"tickSize":1}}`))
	})
	mux.HandleFunc("/api/OmsOrder/Post", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"isSuccessful":true}`))
	})
	return httptest.NewServer(mux)
}

func TestCaptureLearnsFromRealBrowser(t *testing.T) {
	if _, err := FindBrowser(); err != nil {
		t.Skip("مرورگر کرومیومی روی این سیستم نیست")
	}
	os.Setenv("SARKHATI_HEADLESS", "1")
	defer os.Unsetenv("SARKHATI_HEADLESS")

	broker := fakeBroker()
	defer broker.Close()

	capturer := NewCapturer()
	if err := capturer.Start("", broker.URL, "test"); err != nil {
		t.Fatalf("مرورگر باز نشد: %v", err)
	}
	defer capturer.Stop()

	deadline := time.Now().Add(45 * time.Second)
	var status CaptureStatus
	for time.Now().Before(deadline) {
		status = capturer.Status()
		if status.LoggedIn && status.OrderPath != "" && status.SearchURL != "" && status.InstrumentURL != "" {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}

	if !status.LoggedIn {
		t.Fatalf("توکن یاد گرفته نشد: %+v", status)
	}
	if status.APIBase != broker.URL {
		t.Errorf("نشانی پایه: %s، انتظار %s", status.APIBase, broker.URL)
	}
	if status.OrderPath != "/api/OmsOrder/Post" {
		t.Errorf("مسیر سفارش: %s", status.OrderPath)
	}
	if !strings.Contains(status.OrderTemplate, "{price}") ||
		!strings.Contains(status.OrderTemplate, `"validityType":1`) {
		t.Errorf("قالب سفارش درست ساخته نشد: %s", status.OrderTemplate)
	}
	if status.TokenExpiresAt == "" {
		t.Error("تاریخ انقضای توکن خوانده نشد")
	}

	// حالا برنامه باید بتواند خودش از همان مسیرهای یادگرفته‌شده استفاده کند.
	hits, err := capturer.SearchSymbols("وتج")
	if err != nil {
		t.Fatalf("جست‌وجو ناموفق: %v", err)
	}
	if len(hits) != 1 || hits[0].Symbol != "وتجارت" || hits[0].ISIN != "IRO1TBAN0001" {
		t.Errorf("نتیجهٔ جست‌وجو: %+v", hits)
	}

	limits, err := capturer.InstrumentLimits("IRO1TBAN0001")
	if err != nil {
		t.Fatalf("اطلاعات نماد گرفته نشد: %v", err)
	}
	if limits.UpperPrice != 5592 || limits.LowerPrice != 5268 {
		t.Errorf("سقف/کف: %+v", limits)
	}
	if limits.LastPrice != 5430 || limits.MaxQuantity != 100000 {
		t.Errorf("آخرین قیمت یا سقف حجم: %+v", limits)
	}

	// و پیکربندی باید کامل و آمادهٔ ارسال باشد.
	cfg := capturer.Learned(DefaultConfig())
	cfg.ISIN, cfg.Symbol, cfg.Quantity = "IRO1TBAN0001", "وتجارت", 1000
	if problems := cfg.Validate(limits); len(problems) != 0 {
		t.Errorf("پیکربندی یادگرفته‌شده معتبر نیست: %v", problems)
	}
}

// اجرای دوبارهٔ برنامه در حالی که پنجرهٔ قبلی باز مانده است نباید شکست بخورد:
// باید به همان پنجره وصل شود.
func TestLaunchBrowserReusesOpenWindow(t *testing.T) {
	if testing.Short() {
		t.Skip("نیاز به مرورگر واقعی دارد")
	}
	if _, err := FindBrowser(); err != nil {
		t.Skipf("مرورگری نصب نیست: %v", err)
	}
	os.Setenv("SARKHATI_HEADLESS", "1")
	defer os.Unsetenv("SARKHATI_HEADLESS")

	first, err := LaunchBrowser("", "about:blank", "reuse-test")
	if err != nil {
		t.Fatalf("مرورگر باز نشد: %v", err)
	}
	defer func() {
		first.Close()
		os.RemoveAll(BrowserProfileDir("reuse-test"))
	}()
	if first.Reused {
		t.Error("اولین اجرا باید خودش مرورگر باز کند")
	}

	second, err := LaunchBrowser("", "about:blank", "reuse-test")
	if err != nil {
		t.Fatalf("اجرای دوم باید به همان پنجره وصل شود، ولی خطا داد: %v", err)
	}
	if !second.Reused || second.Port != first.Port {
		t.Errorf("به پنجرهٔ باز وصل نشد: reused=%v port=%d/%d", second.Reused, second.Port, first.Port)
	}
	if !second.Running() {
		t.Error("پنجرهٔ بازِ دوباره‌استفاده‌شده باید زنده شناخته شود")
	}
}
