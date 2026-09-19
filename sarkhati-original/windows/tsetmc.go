package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// گرفتن فهرست نمادها و قیمت‌ها از سایت TSETMC.
//
// مزیتش نسبت به فهرست خود کارگزار این است که به ورود و توکن وابسته نیست و هر
// بار که برنامه بالا می‌آید تازه گرفته می‌شود. مرجع سقف و کف مجاز همچنان خود
// کارگزار است؛ اینجا فقط نام نماد و قیمت‌های تابلو را می‌گیریم.

// TsePrice قیمت‌های تابلوی یک نماد.
type TsePrice struct {
	Last      float64 `json:"last"`
	Closing   float64 `json:"closing"`
	Yesterday float64 `json:"yesterday"`
}

// DefaultTsetmcURLs نشانی‌های پیش‌فرض، به ترتیب امتحان می‌شوند.
//
// قابل تغییر در فایل تنظیمات‌اند: اگر TSETMC مسیرهایش را عوض کرد، بدون
// نسخهٔ تازهٔ برنامه هم می‌شود درستش کرد.
var DefaultTsetmcURLs = []string{
	// ترتیب بر اساس اندازه‌گیری واقعی روی اینترنت ایران:
	// cdn → ۲.۱ مگابایت و ۳۵۴۴ نماد، old → ۱.۳ مگابایت و ۳۵۹۷ نماد،
	// و بقیه پاسخ ۸۲۴ بایتی بدون نماد می‌دهند (صفحهٔ خطا).
	"https://cdn.tsetmc.com/api/ClosingPrice/GetMarketWatch?market=0" +
		"&paperTypes[0]=1&paperTypes[1]=2&paperTypes[2]=3&paperTypes[3]=4" +
		"&paperTypes[4]=5&paperTypes[5]=6&paperTypes[6]=7&paperTypes[7]=8" +
		"&paperTypes[8]=9&showTraded=false&withBestLimits=false&hEven=0&RefID=0",
	"https://old.tsetmc.com/tsev2/data/MarketWatchPlus.aspx?h=0&r=0",
	"https://main.tsetmc.com/tsev2/data/MarketWatchPlus.aspx?h=0&r=0",
	"https://tsetmc.ir/tsev2/data/MarketWatchPlus.aspx?h=0&r=0",
	"http://tsetmc.ir/tsev2/data/MarketWatchPlus.aspx?h=0&r=0",
	"http://www.tsetmc.com/tsev2/data/MarketWatchPlus.aspx?h=0&r=0",
}

// URLProbe نتیجهٔ امتحان کردن یک نشانی.
type URLProbe struct {
	URL      string `json:"url"`
	Status   int    `json:"status"`
	Bytes    int    `json:"bytes"`
	Symbols  int    `json:"symbols"`
	Millis   int64  `json:"millis"`
	Error    string `json:"error"`
	Snippet  string `json:"snippet"`
	Selected bool   `json:"selected"`
}

// ProbeTsetmcURLs همهٔ نشانی‌ها را جدا‌جدا امتحان می‌کند و گزارش می‌دهد.
//
// چون از هر شبکه‌ای بعضی دامنه‌های TSETMC باز و بعضی بسته‌اند، به‌جای حدس،
// روی همان کامپیوتری که برنامه اجرا می‌شود آزمایش می‌کنیم.
func ProbeTsetmcURLs(urls []string, timeout time.Duration) []URLProbe {
	if len(urls) == 0 {
		urls = DefaultTsetmcURLs
	}
	client := tsetmcClient(timeout)
	defer client.CloseIdleConnections()

	probes := make([]URLProbe, 0, len(urls))
	best := -1
	for _, target := range urls {
		probe := URLProbe{URL: target}
		started := time.Now()
		body, status, err := fetchTsetmcDetailed(client, target)
		probe.Millis = time.Since(started).Milliseconds()
		probe.Status = status
		probe.Bytes = len(body)
		if err != nil {
			probe.Error = err.Error()
		} else {
			hits, _ := parseTsetmc(body)
			probe.Symbols = len(hits)
			probe.Snippet = snippet(body, 120)
			if best < 0 && len(hits) > 0 {
				best = len(probes)
			}
		}
		probes = append(probes, probe)
	}
	if best >= 0 {
		probes[best].Selected = true
	}
	return probes
}

func snippet(body string, max int) string {
	runes := []rune(strings.TrimSpace(body))
	if len(runes) <= max {
		return string(runes)
	}
	return string(runes[:max]) + "…"
}

var (
	lastPriceKeyRe = regexp.MustCompile(`(?i)^(pdrcotval|lasttradedprice|last|pl|pdr)$`)
	closingKeyRe   = regexp.MustCompile(`(?i)^(pclosing|closingprice|pc|closing)$`)
	yesterdayKeyRe = regexp.MustCompile(`(?i)^(priceyesterday|pricey|py|yesterdayprice|pcy|feeofpreviousdaysclosingprice)$`)
)

// tsetmcClient مرورگر را تقلید می‌کند؛ TSETMC به درخواست بدون User-Agent
// معمولاً جواب نمی‌دهد.
func tsetmcClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:   timeout,
		Transport: &http.Transport{Proxy: http.ProxyFromEnvironment},
	}
}

// FetchTSETMC فهرست نمادها و قیمت‌هایشان را از اولین نشانیِ پاسخ‌ده می‌گیرد.
func FetchTSETMC(urls []string, timeout time.Duration) ([]SymbolHit, map[string]TsePrice, string, error) {
	if len(urls) == 0 {
		urls = DefaultTsetmcURLs
	}
	client := tsetmcClient(timeout)
	defer client.CloseIdleConnections()

	var lastErr error
	for _, target := range urls {
		body, err := fetchTsetmcBody(client, target)
		if err != nil {
			lastErr = err
			continue
		}
		hits, prices := parseTsetmc(body)
		if len(hits) > 0 {
			return hits, prices, target, nil
		}
		lastErr = fmt.Errorf("پاسخ %s نمادی نداشت", target)
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("هیچ نشانی‌ای امتحان نشد")
	}
	return nil, nil, "", lastErr
}

func fetchTsetmcBody(client *http.Client, target string) (string, error) {
	body, _, err := fetchTsetmcDetailed(client, target)
	return body, err
}

// fetchTsetmcDetailed علاوه بر بدنه، کد وضعیت را هم برمی‌گرداند.
func fetchTsetmcDetailed(client *http.Client, target string) (string, int, error) {
	req, err := http.NewRequest(http.MethodGet, target, nil)
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "+
		"AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Accept-Language", "fa,en;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", resp.StatusCode, fmt.Errorf("پاسخ HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return "", resp.StatusCode, err
	}
	return string(data), resp.StatusCode, nil
}

// parseTsetmc هر دو شکل پاسخ TSETMC را می‌فهمد: JSON تازه و متن قدیمی.
func parseTsetmc(body string) ([]SymbolHit, map[string]TsePrice) {
	trimmed := strings.TrimSpace(body)
	if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") {
		return parseTsetmcJSON(trimmed)
	}
	return parseTsetmcText(trimmed)
}

// parseTsetmcJSON بدون تکیه بر نام دقیق کلیدها کار می‌کند: نماد از روی الگوی
// ISIN پیدا می‌شود و قیمت‌ها از روی نام‌های شناخته‌شدهٔ TSETMC.
func parseTsetmcJSON(body string) ([]SymbolHit, map[string]TsePrice) {
	var decoded interface{}
	if json.Unmarshal([]byte(body), &decoded) != nil {
		return nil, nil
	}
	hits := []SymbolHit{}
	prices := map[string]TsePrice{}
	seen := map[string]bool{}

	var walk func(value interface{})
	walk = func(value interface{}) {
		switch typed := value.(type) {
		case map[string]interface{}:
			if hit, ok := symbolFromObject(typed, true); ok && !seen[hit.ISIN] {
				seen[hit.ISIN] = true
				hits = append(hits, hit)
				if price, ok := priceFromObject(typed); ok {
					prices[hit.ISIN] = price
				}
			}
			for _, child := range typed {
				walk(child)
			}
		case []interface{}:
			for _, child := range typed {
				walk(child)
			}
		}
	}
	walk(decoded)
	return hits, prices
}

func priceFromObject(object map[string]interface{}) (TsePrice, bool) {
	price := TsePrice{}
	found := false
	for key, value := range object {
		number, ok := toFloat(value)
		if !ok {
			continue
		}
		switch {
		case lastPriceKeyRe.MatchString(key):
			price.Last, found = number, true
		case closingKeyRe.MatchString(key):
			price.Closing, found = number, true
		case yesterdayKeyRe.MatchString(key):
			price.Yesterday, found = number, true
		}
	}
	return price, found
}

func toFloat(value interface{}) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case string:
		number, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return number, err == nil
	}
	return 0, false
}

// parseTsetmcText شکل قدیمی و متنی MarketWatchPlus را می‌خواند.
//
// هر ردیف با کاما جدا شده و ترتیب ستون‌ها ثابت است، ولی به‌جای تکیه بر شماره
// ستون، کد ISIN را با الگو پیدا می‌کنیم و از روی آن جلو می‌رویم — اگر روزی یک
// ستون اضافه شود، این روش نمی‌شکند.
func parseTsetmcText(body string) ([]SymbolHit, map[string]TsePrice) {
	hits := []SymbolHit{}
	prices := map[string]TsePrice{}
	seen := map[string]bool{}

	for _, section := range strings.Split(body, "@") {
		for _, row := range strings.Split(section, ";") {
			fields := strings.Split(row, ",")
			if len(fields) < 5 {
				continue
			}
			isinAt := -1
			for i, field := range fields {
				if isinValueRe.MatchString(strings.TrimSpace(field)) {
					isinAt = i
					break
				}
			}
			if isinAt < 0 || isinAt+2 >= len(fields) {
				continue
			}
			isin := strings.TrimSpace(fields[isinAt])
			symbol := strings.TrimSpace(fields[isinAt+1])
			name := strings.TrimSpace(fields[isinAt+2])
			if symbol == "" || seen[isin] || indexISINRe.MatchString(isin) {
				continue
			}
			seen[isin] = true
			hits = append(hits, SymbolHit{ISIN: isin, Symbol: symbol, Name: name})

			// ستون‌های عددی بعد از نام: اولین قیمت، آخرین، پایانی … و دیروز.
			numbers := make([]float64, 0, 8)
			for _, field := range fields[isinAt+3:] {
				number, err := strconv.ParseFloat(strings.TrimSpace(field), 64)
				if err != nil {
					break
				}
				numbers = append(numbers, number)
			}
			if len(numbers) >= 3 {
				prices[isin] = TsePrice{
					Last:      numbers[1],
					Closing:   numbers[2],
					Yesterday: numbers[len(numbers)-1],
				}
			}
		}
	}
	return hits, prices
}
