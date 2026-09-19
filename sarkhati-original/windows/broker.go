package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// پرس‌وجو از همان درخواست‌هایی که از ایزی‌تریدر یاد گرفته‌ایم: جست‌وجوی نماد و
// اطلاعات نماد. نشانی و توکن از لایهٔ یادگیری می‌آید، پس هیچ مسیری حدس زده
// نمی‌شود.

// SymbolHit یک نتیجهٔ جست‌وجوی نماد.
type SymbolHit struct {
	ISIN   string `json:"isin"`
	Symbol string `json:"symbol"`
	Name   string `json:"name"`
}

// Limits محدودیت‌هایی که خود کارگزاری برای نماد اعلام می‌کند.
type Limits struct {
	UpperPrice  float64            `json:"upper_price"`
	LowerPrice  float64            `json:"lower_price"`
	LastPrice   float64            `json:"last_price"`
	Tick        float64            `json:"tick"`
	MaxQuantity float64            `json:"max_quantity"`
	MinQuantity float64            `json:"min_quantity"`
	Fields      map[string]float64 `json:"fields"`
	Source      string             `json:"source"`
}

var (
	upperPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(maxallow|allowedmax|highallow|pricemax|maxprice|upperlimit|ceil|tmax|psgelstamax|highthreshold)`),
		regexp.MustCompile(`(?i)(^max$|highest|top)`),
	}
	lowerPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(minallow|allowedmin|lowallow|pricemin|minprice|lowerlimit|floor|tmin|psgelstamin|lowthreshold)`),
		regexp.MustCompile(`(?i)(^min$|lowest|bottom)`),
	}
	lastPricePatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(closingprice|pclosing|finalprice|lastprice|pdrcotval|closeprice)`),
		regexp.MustCompile(`(?i)(^last$|^close$|^final$)`),
	}
	tickPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(ticksize|pricetick|^tick$|steppr)`),
	}
	maxQuantityPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(maxquantity|maxvolume|maxorderquantity|maxtradequantity|maxorderq)`),
	}
	minQuantityPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(minquantity|minvolume|minorderquantity|mintradequantity|minorderq)`),
	}
)

func brokerClient() *http.Client {
	return &http.Client{
		Timeout:   8 * time.Second,
		Transport: &http.Transport{Proxy: http.ProxyFromEnvironment},
	}
}

// fetchJSON درخواست یادگرفته‌شده را با توکن جاری تکرار می‌کند.
func (c *Capturer) fetchJSON(method, rawURL, body string) (json.RawMessage, error) {
	return c.fetchJSONWithHeaders(method, rawURL, body, nil)
}

func (c *Capturer) fetchJSONWithHeaders(method, rawURL, body string,
	headers map[string]string) (json.RawMessage, error) {
	token, apiBase := c.Token()
	if token == "" {
		return nil, fmt.Errorf("هنوز وارد ایزی‌تریدر نشده‌اید")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	// فقط به میزبان‌هایی می‌زنیم که خودِ ایزی‌تریدر با آن‌ها حرف زده. کارگزاری
	// چند میزبان دارد (دروازه، OMS، نمادها) و محدود کردن به یکی، بقیه را
	// بی‌دلیل می‌بندد.
	base, _ := url.Parse(apiBase)
	if !c.KnownHost(parsed.Host) && (base == nil || base.Host != parsed.Host) {
		return nil, fmt.Errorf("نشانی %s از میزبان‌های شناخته‌شدهٔ کارگزار نیست", parsed.Host)
	}

	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	if method == "" {
		method = http.MethodGet
	}
	req, err := http.NewRequest(method, rawURL, reader)
	if err != nil {
		return nil, err
	}
	// هدرهای همان درخواست واقعی، بعد توکن تازه رویشان.
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if req.Header.Get("Accept") == "" {
		req.Header.Set("Accept", "application/json")
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := brokerClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("توکن منقضی شده؛ در پنجرهٔ ایزی‌تریدر دوباره وارد شوید")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// متن پاسخ را هم می‌آوریم؛ بدون آن، عیب‌یابی حدس زدن است.
		return nil, fmt.Errorf("کارگزار پاسخ HTTP %d داد: %s",
			resp.StatusCode, trim(string(payload), 300))
	}
	return json.RawMessage(payload), nil
}

// SearchSymbols نماد را پیدا می‌کند.
//
// اول از مسیر جست‌وجوی خود کارگزار (اگر یاد گرفته شده باشد) و بعد از جدول
// نمادهایی که از ترافیک ایزی‌تریدر جمع شده. خیلی از وب‌اپ‌ها فهرست کل بازار
// را یک‌بار می‌گیرند و جست‌وجو را داخل مرورگر انجام می‌دهند؛ در آن حالت هیچ
// درخواست جست‌وجویی وجود ندارد و تنها راه، همین جدول محلی است.
func (c *Capturer) SearchSymbols(term string) ([]SymbolHit, error) {
	if endpoint := c.endpointOf("search"); endpoint != nil {
		if target, body, ok := endpoint.With(term); ok {
			if raw, err := c.fetchJSONWithHeaders(endpoint.Method, target, body, endpoint.Headers); err == nil {
				if hits := extractSymbols(raw); len(hits) > 0 {
					if len(hits) > 30 {
						hits = hits[:30]
					}
					return hits, nil
				}
			}
		}
	}
	if hits := c.LocalSearch(term); len(hits) > 0 {
		return hits, nil
	}
	if c.endpointOf("search") == nil && len(c.Symbols()) == 0 {
		return nil, fmt.Errorf("فهرست نمادها هنوز جمع نشده؛ در ایزی‌تریدر نمادی را جست‌وجو یا باز کنید")
	}
	return nil, nil
}

var cacheKeyRe = regexp.MustCompile(`(?i)(hash|etag|version|since|lastupdate|lastmodified|checksum|revision)`)

// RefreshSymbols فهرست کل نمادها را از همان درخواستی که وب‌اپ می‌زند می‌گیرد.
//
// نکتهٔ اصلی: آن درخواست یک هشِ کش همراه دارد و اگر فهرست تغییر نکرده باشد
// سرور چیزی برنمی‌گرداند. پس هش را خالی می‌فرستیم تا فهرست کامل بیاید.
func (c *Capturer) RefreshSymbols() (int, error) {
	request := c.SymbolListRequest()
	if request == nil {
		return 0, fmt.Errorf("درخواست فهرست نمادها هنوز دیده نشده؛ ایزی‌تریدر را باز کنید و وارد شوید")
	}

	target := clearCacheParams(request.URL)

	// چند شکلِ درخواست را امتحان می‌کنیم؛ هر سروری یک‌جور «همه‌اش را بده»
	// را می‌فهمد. اولی که نماد برگرداند برنده است.
	attempts := []string{clearCacheFields(request.PostData)}
	if request.PostData != "" {
		attempts = append(attempts, "{}", "")
	}

	var hits []SymbolHit
	var lastErr error
	for _, body := range attempts {
		raw, err := c.fetchJSON(request.Method, target, body)
		if err != nil {
			lastErr = err
			continue
		}
		if found := extractSymbols(raw); len(found) > len(hits) {
			hits = found
		}
		if len(hits) > 100 {
			break // فهرست کامل آمد
		}
	}

	if len(hits) == 0 {
		if lastErr != nil {
			return 0, fmt.Errorf("گرفتن فهرست نمادها ناموفق بود: %w", lastErr)
		}
		return 0, fmt.Errorf("پاسخ فهرست نمادها خالی بود یا شکل ناشناخته‌ای داشت")
	}
	c.mu.Lock()
	c.mergeSymbols(hits)
	count := len(c.symbols)
	c.fullList = true
	c.mu.Unlock()
	return count, nil
}

// clearCacheFields فیلدهای کشِ بدنهٔ JSON را خالی می‌کند.
func clearCacheFields(body string) string {
	trimmed := strings.TrimSpace(body)
	if trimmed == "" {
		return ""
	}
	var parsed map[string]interface{}
	if json.Unmarshal([]byte(trimmed), &parsed) != nil {
		return trimmed
	}
	for key, value := range parsed {
		if !cacheKeyRe.MatchString(key) {
			continue
		}
		switch value.(type) {
		case string:
			parsed[key] = ""
		default:
			parsed[key] = nil
		}
	}
	encoded, err := json.Marshal(parsed)
	if err != nil {
		return trimmed
	}
	return string(encoded)
}

// clearCacheParams همان کار را برای پارامترهای نشانی انجام می‌دهد.
func clearCacheParams(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	query := parsed.Query()
	changed := false
	for name := range query {
		if cacheKeyRe.MatchString(name) {
			query.Set(name, "")
			changed = true
		}
	}
	if !changed {
		return rawURL
	}
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

// LocalSearch روی جدول نمادهای جمع‌شده جست‌وجو می‌کند.
func (c *Capturer) LocalSearch(term string) []SymbolHit {
	needle := normalizePersian(term)
	if needle == "" {
		return nil
	}
	var prefix, contains []SymbolHit
	for _, hit := range c.Symbols() {
		symbol := normalizePersian(hit.Symbol)
		switch {
		case strings.HasPrefix(symbol, needle):
			prefix = append(prefix, hit)
		case strings.Contains(symbol, needle) || strings.Contains(normalizePersian(hit.Name), needle):
			contains = append(contains, hit)
		}
	}
	sort.Slice(prefix, func(i, j int) bool { return len(prefix[i].Symbol) < len(prefix[j].Symbol) })
	sort.Slice(contains, func(i, j int) bool { return len(contains[i].Symbol) < len(contains[j].Symbol) })

	out := append(prefix, contains...)
	if len(out) > 30 {
		out = out[:30]
	}
	return out
}

// normalizePersian تفاوت‌های نوشتاری فارسی و عربی را یکسان می‌کند.
//
// داده‌های بورس ایران «ی» و «ي»، «ک» و «ك» و ارقام فارسی و عربی را قاطی
// دارند؛ بدون این یکسان‌سازی، جست‌وجوی کاربر بی‌دلیل نتیجه نمی‌دهد.
func normalizePersian(text string) string {
	replacer := strings.NewReplacer(
		"ي", "ی", "ك", "ک", "ۀ", "ه", "ة", "ه", "أ", "ا", "إ", "ا", "آ", "ا",
		"\u200c", " ", "\u200f", "", "\u200e", "",
		"۰", "0", "۱", "1", "۲", "2", "۳", "3", "۴", "4",
		"۵", "5", "۶", "6", "۷", "7", "۸", "8", "۹", "9",
		"٠", "0", "١", "1", "٢", "2", "٣", "3", "٤", "4",
		"٥", "5", "٦", "6", "٧", "7", "٨", "8", "٩", "9",
	)
	return strings.TrimSpace(strings.ToLower(replacer.Replace(text)))
}

// extractSymbols نمادها را از هر شکلی از JSON بیرون می‌کشد.
//
// اول دنبال *مقدارِ* شبیه ISIN می‌گردیم (الگویی که در بورس ایران ثابت است).
// اگر کارگزار اصلاً ISIN برنگرداند، سراغ شناسهٔ داخلی خودش می‌رویم.
func extractSymbols(raw json.RawMessage) []SymbolHit {
	var decoded interface{}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil
	}
	if hits := walkSymbols(decoded, true); len(hits) > 0 {
		return hits
	}
	return walkSymbols(decoded, false)
}

func walkSymbols(decoded interface{}, requireISIN bool) []SymbolHit {
	var hits []SymbolHit
	seen := map[string]bool{}

	var walk func(value interface{})
	walk = func(value interface{}) {
		switch typed := value.(type) {
		case map[string]interface{}:
			if len(hits) >= 100_000 {
				return // سقف ایمنی؛ کل بازار ایران خیلی کمتر از این است
			}
			if hit, ok := symbolFromObject(typed, requireISIN); ok && !seen[hit.ISIN] {
				seen[hit.ISIN] = true
				hits = append(hits, hit)
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
	return hits
}

func symbolFromObject(object map[string]interface{}, requireISIN bool) (SymbolHit, bool) {
	hit := SymbolHit{}
	identifier := ""

	for key, child := range object {
		lowerKey := strings.ToLower(key)
		text, isString := child.(string)
		if !isString {
			// شناسهٔ عددی هم شناسه است.
			if number, isNumber := child.(float64); isNumber && identifier == "" &&
				identifierKeyRe.MatchString(lowerKey) {
				identifier = strconv.FormatInt(int64(number), 10)
			}
			continue
		}
		switch {
		case isinRe.MatchString(text) && hit.ISIN == "":
			hit.ISIN = isinRe.FindString(text)
		case symbolKeyRe.MatchString(lowerKey) && hit.Symbol == "":
			hit.Symbol = strings.TrimSpace(text)
		case nameKeyRe.MatchString(lowerKey) && hit.Name == "":
			hit.Name = strings.TrimSpace(text)
		case identifierKeyRe.MatchString(lowerKey) && identifier == "":
			identifier = strings.TrimSpace(text)
		}
	}

	// اگر ISIN داریم ولی کلیدها نام آشنا ندارند، از روی طول متن‌ها حدس می‌زنیم:
	// نام نماد کوتاه است و نام شرکت بلند.
	if hit.ISIN != "" && hit.Symbol == "" {
		shortest, longest := "", ""
		for key, child := range object {
			text, isString := child.(string)
			if !isString || isinRe.MatchString(text) || identifierKeyRe.MatchString(strings.ToLower(key)) {
				continue
			}
			trimmed := strings.TrimSpace(text)
			runes := []rune(trimmed)
			if len(runes) == 0 || len(runes) > 60 {
				continue
			}
			// کد عددیِ نماد (مثل insCode در TSETMC) نام نماد نیست.
			if !hasLetter(trimmed) {
				continue
			}
			if shortest == "" || len(runes) < len([]rune(shortest)) {
				shortest = trimmed
			}
			if len(runes) > len([]rune(longest)) {
				longest = trimmed
			}
		}
		if shortest != "" && len([]rune(shortest)) <= 14 {
			hit.Symbol = shortest
			if longest != shortest {
				hit.Name = longest
			}
		}
	}

	if hit.ISIN == "" {
		if requireISIN {
			return SymbolHit{}, false
		}
		// بدون ISIN فقط وقتی نتیجه است که دست‌کم نام نماد را داشته باشیم.
		if hit.Symbol == "" {
			return SymbolHit{}, false
		}
		hit.ISIN = identifier
		if hit.ISIN == "" {
			hit.ISIN = hit.Symbol
		}
	}
	if hit.Symbol == "" {
		hit.Symbol = hit.Name
	}
	if hit.Symbol == "" {
		return SymbolHit{}, false
	}
	return hit, true
}

// hasLetter می‌گوید متن دست‌کم یک حرف دارد (نه فقط رقم و نشانه).
func hasLetter(text string) bool {
	for _, r := range text {
		if unicode.IsLetter(r) {
			return true
		}
	}
	return false
}

var (
	symbolKeyRe     = regexp.MustCompile(`(?i)(symbol|namad|lval18|^sym$|ticker)`)
	nameKeyRe       = regexp.MustCompile(`(?i)(name|lval30|title|company|description)`)
	identifierKeyRe = regexp.MustCompile(`(?i)(^id$|instrumentid|symbolid|code|key|isin)`)
)

// InstrumentLimits سقف و کف مجاز و محدودیت حجم را از خود کارگزار می‌گیرد.
//
// همهٔ منابع یادگرفته‌شده خوانده و نتیجه‌ها با هم ترکیب می‌شوند: هیچ پاسخی
// همهٔ اعداد را ندارد — یکی سقف و کف قیمت دارد و دیگری حداکثر حجم مجاز.
func (c *Capturer) InstrumentLimits(isin string) (Limits, error) {
	endpoints := c.InstrumentEndpoints()
	if len(endpoints) == 0 {
		return Limits{}, fmt.Errorf("اطلاعات نماد هنوز یاد گرفته نشده؛ یک نماد را در ایزی‌تریدر باز کنید")
	}

	limits := Limits{Fields: map[string]float64{}}
	var lastErr error
	found := false

	for _, endpoint := range endpoints {
		target, body, ok := endpoint.With(isin)
		if !ok {
			// بعضی مسیرها کد نماد را داخل خودِ مسیر دارند.
			if isinRe.MatchString(endpoint.URL) {
				target, body = isinRe.ReplaceAllString(endpoint.URL, isin), endpoint.PostData
			} else {
				continue
			}
		}
		raw, err := c.fetchJSONWithHeaders(endpoint.Method, target, body, endpoint.Headers)
		if err != nil {
			lastErr = err
			continue
		}
		found = true
		limits.Source = target
		mergeLimits(&limits, numbersByKey(raw))
	}

	if !found {
		if lastErr != nil {
			if isinValueRe.MatchString(endpoints[0].Sample) && !isinValueRe.MatchString(isin) {
				return Limits{}, fmt.Errorf(
					"شناسهٔ این نماد (%s) کد ISIN نیست ولی مسیر اطلاعات نماد ISIN می‌خواهد", isin)
			}
			return Limits{}, lastErr
		}
		return Limits{}, fmt.Errorf("جای کد نماد در درخواست یادگرفته‌شده پیدا نشد")
	}

	// کف نباید از سقف بزرگ‌تر باشد؛ اگر شد یعنی تشخیص اشتباه بوده.
	if limits.LowerPrice > 0 && limits.UpperPrice > 0 && limits.LowerPrice > limits.UpperPrice {
		limits.LowerPrice, limits.UpperPrice = limits.UpperPrice, limits.LowerPrice
	}
	return limits, nil
}

// mergeLimits اعداد یک پاسخ را روی نتیجه می‌نشاند، بدون پاک کردن آنچه داریم.
func mergeLimits(limits *Limits, fields map[string]float64) {
	for key, value := range fields {
		if _, exists := limits.Fields[key]; !exists {
			limits.Fields[key] = value
		}
	}
	set := func(target *float64, patterns []*regexp.Regexp) {
		if *target == 0 {
			*target = pickNumber(fields, patterns)
		}
	}
	set(&limits.UpperPrice, upperPatterns)
	set(&limits.LowerPrice, lowerPatterns)
	set(&limits.LastPrice, lastPricePatterns)
	set(&limits.Tick, tickPatterns)
	set(&limits.MaxQuantity, maxQuantityPatterns)
	set(&limits.MinQuantity, minQuantityPatterns)
}

// pickNumber اولین کلیدی که با الگوها می‌خواند را برمی‌دارد؛ الگوهای دقیق‌تر اول.
func pickNumber(fields map[string]float64, patterns []*regexp.Regexp) float64 {
	for _, pattern := range patterns {
		best := 0.0
		for key, value := range fields {
			if value > 0 && pattern.MatchString(key) && (best == 0 || len(key) < len(keyOf(fields, best))) {
				best = value
			}
		}
		if best > 0 {
			return best
		}
	}
	return 0
}

func keyOf(fields map[string]float64, value float64) string {
	for key, candidate := range fields {
		if candidate == value {
			return key
		}
	}
	return ""
}
