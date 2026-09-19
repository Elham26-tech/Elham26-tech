package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// شکل تازهٔ API سایت (cdn.tsetmc.com) با نام‌های میدانی TSETMC.
const tsetmcJSON = `{"marketwatch":[
 {"insCode":"63917421733088077","insID":"IRO1TBAN0001","lVal18AFC":"وتجارت","lVal30":"بانك تجارت",
  "pDrCotVal":16650,"pClosing":16650,"priceYesterday":16170,"zTotTran":19781},
 {"insCode":"35425587644337450","insID":"IRO1FOLD0001","lVal18AFC":"فولاد","lVal30":"فولاد مباركه اصفهان",
  "pDrCotVal":5592,"pClosing":5570,"priceYesterday":5430,"zTotTran":8123},
 {"insCode":"999","insID":"IRX6XS300006","lVal18AFC":"شاخص 30 شركت","lVal30":"شاخص","pDrCotVal":540035}]}`

func TestParseTsetmcJSON(t *testing.T) {
	hits, prices := parseTsetmc(tsetmcJSON)
	if len(hits) != 3 {
		t.Fatalf("تعداد نمادهای استخراج‌شده: %d", len(hits))
	}
	var tejarat *SymbolHit
	for i := range hits {
		if hits[i].ISIN == "IRO1TBAN0001" {
			tejarat = &hits[i]
		}
	}
	if tejarat == nil || tejarat.Symbol != "وتجارت" || tejarat.Name != "بانك تجارت" {
		t.Fatalf("وتجارت درست خوانده نشد: %+v", tejarat)
	}
	price := prices["IRO1TBAN0001"]
	if price.Last != 16650 || price.Closing != 16650 || price.Yesterday != 16170 {
		t.Errorf("قیمت‌ها: %+v", price)
	}
}

// اگر TSETMC نام کلیدها را عوض کند، تشخیص نباید بشکند: کد ISIN و طول متن‌ها
// کافی است.
func TestParseTsetmcJSONWithUnknownKeys(t *testing.T) {
	body := `{"d":[{"c":"6391","i":"IRO1TBAN0001","a":"وتجارت","b":"بانك تجارت","pc":16650,"py":16170}]}`
	hits, prices := parseTsetmc(body)
	if len(hits) != 1 || hits[0].Symbol != "وتجارت" || hits[0].Name != "بانك تجارت" {
		t.Fatalf("نماد: %+v", hits)
	}
	if prices["IRO1TBAN0001"].Closing != 16650 || prices["IRO1TBAN0001"].Yesterday != 16170 {
		t.Errorf("قیمت: %+v", prices["IRO1TBAN0001"])
	}
}

// شکل قدیمی و متنی MarketWatchPlus.
func TestParseTsetmcLegacyText(t *testing.T) {
	body := "ver@" +
		"63917421733088077,IRO1TBAN0001,وتجارت,بانك تجارت,16000,16650,16650,19781,145303410,2419213115250,16000,16650,16170;" +
		"35425587644337450,IRO1FOLD0001,فولاد,فولاد مباركه,5400,5592,5570,8123,1000,2000,5300,5600,5430" +
		"@extra"
	hits, prices := parseTsetmc(body)
	if len(hits) != 2 {
		t.Fatalf("تعداد: %d", len(hits))
	}
	if hits[0].ISIN != "IRO1TBAN0001" || hits[0].Symbol != "وتجارت" {
		t.Errorf("نماد اول: %+v", hits[0])
	}
	if prices["IRO1TBAN0001"].Yesterday != 16170 {
		t.Errorf("قیمت دیروز: %+v", prices["IRO1TBAN0001"])
	}
}

func TestParseTsetmcTextSkipsIndices(t *testing.T) {
	body := "@1,IRX6XS300006,شاخص 30 شركت,شاخص,1,2,3,4,5,6,7,8,9"
	if hits, _ := parseTsetmc(body); len(hits) != 0 {
		t.Errorf("شاخص نباید نماد حساب شود: %+v", hits)
	}
}

func TestMergeTsetmcKeepsIndicesOut(t *testing.T) {
	c := NewCapturer()
	hits, prices := parseTsetmc(tsetmcJSON)
	c.MergeTsetmc(hits, prices, "https://cdn.tsetmc.com/...", nil)

	status := c.Status()
	if status.SymbolCount != 2 {
		t.Errorf("شاخص باید کنار گذاشته شود، تعداد: %d", status.SymbolCount)
	}
	if status.TsetmcCount != 3 || !strings.Contains(status.TsetmcSource, "tsetmc") {
		t.Errorf("وضعیت TSETMC: %+v", status)
	}
	if hits := c.LocalSearch("وتج"); len(hits) != 1 {
		t.Errorf("جست‌وجو روی فهرست TSETMC: %+v", hits)
	}
	if price, ok := c.PriceOf("IRO1FOLD0001"); !ok || price.Yesterday != 5430 {
		t.Errorf("قیمت فولاد: %+v", price)
	}
}

func TestMergeTsetmcRecordsError(t *testing.T) {
	c := NewCapturer()
	c.MergeTsetmc(nil, nil, "", errTest)
	if status := c.Status(); status.TsetmcError == "" {
		t.Error("خطای TSETMC باید در وضعیت بیاید")
	}
}

var errTest = fmt.Errorf("tsetmc پاسخ نداد")

func TestProbeReportsPerURLResult(t *testing.T) {
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(tsetmcJSON))
	}))
	defer good.Close()
	forbidden := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer forbidden.Close()

	probes := ProbeTsetmcURLs([]string{forbidden.URL, good.URL}, 5*time.Second)
	if len(probes) != 2 {
		t.Fatalf("تعداد نتایج: %d", len(probes))
	}
	if probes[0].Status != 403 || probes[0].Error == "" {
		t.Errorf("نشانی مسدود باید خطا بدهد: %+v", probes[0])
	}
	if probes[1].Symbols != 3 || !probes[1].Selected {
		t.Errorf("نشانی سالم باید انتخاب شود: %+v", probes[1])
	}
}

func TestDefaultURLsIncludeIranianDomain(t *testing.T) {
	joined := strings.Join(DefaultTsetmcURLs, " ")
	for _, want := range []string{"tsetmc.ir", "cdn.tsetmc.com", "main.tsetmc.com"} {
		if !strings.Contains(joined, want) {
			t.Errorf("%s در فهرست پیش‌فرض نیست", want)
		}
	}
}
