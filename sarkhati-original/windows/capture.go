package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// لایهٔ یادگیری: به‌جای اینکه کاربر دستی سراغ تب Network برود، خود برنامه
// ترافیک ایزی‌تریدر را تماشا می‌کند و یاد می‌گیرد.
//
// تشخیص بر اساس *محتوای پاسخ* انجام می‌شود نه نام مسیر: نام مسیرها بین
// کارگزاری‌ها و حتی بین نسخه‌های یک کارگزاری فرق می‌کند، ولی پاسخِ یک
// جست‌وجوی نماد همیشه چند کد ISIN دارد و پاسخِ اطلاعات نماد همیشه سقف و کف
// عددی دارد. همین نشانه‌ها پایدارند.

// CapturedRequest یک درخواست دیده‌شده در مرورگر.
type CapturedRequest struct {
	ID       string            `json:"-"`
	Headers  map[string]string `json:"-"`
	Method   string            `json:"method"`
	URL      string            `json:"url"`
	Path     string            `json:"path"`
	PostData string            `json:"post_data,omitempty"`
	Preview  string            `json:"preview,omitempty"`
	Kind     string            `json:"kind"`
	At       time.Time         `json:"at"`
}

// CaptureStatus خلاصه‌ای که رابط کاربری نشان می‌دهد.
type CaptureStatus struct {
	BrowserRunning bool   `json:"browser_running"`
	LoggedIn       bool   `json:"logged_in"`
	APIBase        string `json:"api_base"`
	TokenPreview   string `json:"token_preview"`
	TokenExpiresAt string `json:"token_expires_at"`
	TokenTTL       string `json:"token_ttl"`
	TokenExpired   bool   `json:"token_expired"`
	OrderPath      string `json:"order_path"`
	OrderURL       string `json:"order_url"`
	OrderTemplate  string `json:"order_template"`
	SearchURL      string `json:"search_url"`
	InstrumentURL  string `json:"instrument_url"`
	CanSearch      bool   `json:"can_search"`
	SymbolCount    int    `json:"symbol_count"`
	CanListSymbols bool   `json:"can_list_symbols"`
	CanBrokerTime  bool   `json:"can_broker_time"`
	SymbolsFull    bool   `json:"symbols_full"`
	TsetmcCount    int    `json:"tsetmc_count"`
	TsetmcSource   string `json:"tsetmc_source"`
	TsetmcError    string `json:"tsetmc_error"`
	CanQuote       bool   `json:"can_quote"`
	CanOrder       bool   `json:"can_order"`
	Ready          bool   `json:"ready"`
	Seen           int    `json:"seen"`
	Hint           string `json:"hint"`
	Profile        string `json:"profile"`
}

// Capturer به مرورگر کنترل‌شده وصل می‌شود و ترافیک را یاد می‌گیرد.
type Capturer struct {
	mu      sync.Mutex
	browser *Browser
	profile string // پروفایل مرورگرِ حسابی که همین حالا باز است
	conns   map[string]*cdpConn
	stop    chan struct{}

	token    string
	apiBase  string
	hosts    map[string]bool // همهٔ میزبان‌هایی که ترافیک احراز‌هویت‌شده داشته‌اند
	requests []CapturedRequest
	byIndex  map[string]int

	order       *CapturedRequest
	search      *Endpoint
	instrument  *Endpoint
	instruments []*Endpoint
	symbolList  *CapturedRequest
	serverTime  *CapturedRequest

	// جدول نمادها: بعضی کارگزاری‌ها (از جمله ایزی‌تریدر) فهرست کل بازار را
	// یک‌بار هنگام ورود می‌گیرند و جست‌وجو را داخل خود مرورگر انجام می‌دهند.
	// در آن حالت هیچ «درخواست جست‌وجو»یی وجود ندارد که یاد گرفته شود، پس
	// خودمان همان فهرست را برمی‌داریم و جست‌وجو را محلی انجام می‌دهیم.
	symbols  map[string]SymbolHit
	prices   map[string]TsePrice
	dirty    bool
	fullList bool // فهرست کامل بازار یک‌بار گرفته شده است

	tsetmcSource string
	tsetmcCount  int
	tsetmcError  string
	tsetmcAt     time.Time
}

func NewCapturer() *Capturer {
	return &Capturer{
		conns:   make(map[string]*cdpConn),
		hosts:   make(map[string]bool),
		byIndex: make(map[string]int),
		symbols: make(map[string]SymbolHit),
		prices:  make(map[string]TsePrice),
	}
}

// Seed آنچه در اجرای قبلی یاد گرفته شده را برمی‌گرداند، تا بعد از ورود
// دوباره لازم نباشد همه‌چیز از نو یاد گرفته شود.
func (c *Capturer) Seed(search, instrument *Endpoint, orderURL, orderPath, orderTemplate, apiBase string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if search != nil && search.URL != "" {
		c.search = search
	}
	if instrument != nil && instrument.URL != "" {
		c.addInstrument(instrument)
	}
	// فقط سفارشی که *واقعاً* دیده شده نشانی کامل دارد. مسیرِ تنها یعنی
	// حدسِ نسخه‌های قدیمی برنامه که در فایل تنظیمات مانده؛ اگر آن را
	// «یادگرفته‌شده» حساب کنیم، سفارش به نشانی اشتباه می‌رود و HTTP 404
	// می‌گیرد، در حالی که رابط کاربری می‌گوید همه‌چیز آماده است.
	if orderURL != "" && c.order == nil {
		c.order = &CapturedRequest{
			Method: "POST", URL: orderURL, Path: orderPath,
			PostData: orderTemplate, Kind: "order",
		}
	}
	if apiBase != "" && c.apiBase == "" {
		c.apiBase = apiBase
	}
}

// Start مرورگر را باز می‌کند و تماشای ترافیک را شروع می‌کند.
//
// profile پروفایل مرورگر است: هر حساب کارگزاری پروفایل خودش را دارد، وگرنه
// ورود به حساب دوم، نشست حساب اول را بیرون می‌اندازد.
func (c *Capturer) Start(browserPath, pageURL, profile string) error {
	c.Stop()
	if pageURL == "" {
		pageURL = EasyTraderURL
	}
	// مرورگر را روی صفحهٔ خالی باز می‌کنیم، اول به آن وصل می‌شویم و *بعد*
	// ایزی‌تریدر را باز می‌کنیم. اگر برعکس باشد، درخواست‌های همان چند صد
	// میلی‌ثانیهٔ اول — که توکن در آن‌هاست — از دست می‌رود.
	browser, err := LaunchBrowser(browserPath, "about:blank", profile)
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.browser = browser
	c.profile = profile
	c.stop = make(chan struct{})
	stop := c.stop
	c.mu.Unlock()

	conn, err := c.attachFirstPage(browser, stop)
	if err != nil {
		browser.Close()
		return err
	}
	if _, err := conn.Call("Page.navigate", map[string]interface{}{"url": pageURL}); err != nil {
		browser.Close()
		return fmt.Errorf("باز کردن ایزی‌تریدر ناموفق بود: %w", err)
	}

	go c.watchTargets(browser, stop)
	return nil
}

// attachFirstPage به اولین تب وصل می‌شود و تماشای شبکه را روشن می‌کند.
func (c *Capturer) attachFirstPage(browser *Browser, stop chan struct{}) (*cdpConn, error) {
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		targets, err := listTargets(browser.Port)
		if err == nil {
			for _, target := range targets {
				if target.Type != "page" || target.WSURL == "" {
					continue
				}
				if conn, err := c.attach(target, stop); err == nil {
					return conn, nil
				}
			}
		}
		select {
		case <-stop:
			return nil, fmt.Errorf("متوقف شد")
		case <-time.After(150 * time.Millisecond):
		}
	}
	return nil, fmt.Errorf("تب مرورگر پیدا نشد")
}

// watchableTarget می‌گوید به این هدف وصل بشویم یا نه.
//
// وب‌اپ‌های امروزی بخشی از درخواست‌ها را از داخل Service Worker می‌فرستند؛
// اگر فقط به تب وصل شویم، آن درخواست‌ها اصلاً دیده نمی‌شوند.
func watchableTarget(target cdpTarget) bool {
	if target.WSURL == "" {
		return false
	}
	switch target.Type {
	case "page", "iframe":
		return strings.HasPrefix(target.URL, "http")
	case "service_worker", "worker", "shared_worker":
		return true
	}
	return false
}

// watchTargets تب‌ها و کارگرهای تازه را پیدا و به هرکدام وصل می‌شود.
func (c *Capturer) watchTargets(browser *Browser, stop chan struct{}) {
	ticker := time.NewTicker(400 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
		}
		targets, err := listTargets(browser.Port)
		if err != nil {
			continue
		}
		for _, target := range targets {
			if !watchableTarget(target) {
				continue
			}
			c.mu.Lock()
			_, attached := c.conns[target.ID]
			c.mu.Unlock()
			if attached {
				continue
			}
			c.attach(target, stop)
		}
	}
}

// attach یک هدف را می‌گیرد، Network را روشن و خواندن رویدادها را شروع می‌کند.
func (c *Capturer) attach(target cdpTarget, stop chan struct{}) (*cdpConn, error) {
	conn, err := dialTarget(target)
	if err != nil {
		return nil, err
	}
	if _, err := conn.Call("Network.enable", map[string]interface{}{
		"maxTotalBufferSize":    64 << 20,
		"maxResourceBufferSize": 32 << 20,
	}); err != nil {
		conn.Close()
		return nil, err
	}
	conn.Call("Page.enable", nil)
	c.mu.Lock()
	c.conns[target.ID] = conn
	c.mu.Unlock()
	go c.consume(target.ID, conn, stop)
	return conn, nil
}

// consume رویدادهای شبکهٔ یک هدف را می‌خواند.
func (c *Capturer) consume(targetID string, conn *cdpConn, stop chan struct{}) {
	defer func() {
		conn.Close()
		c.mu.Lock()
		delete(c.conns, targetID)
		c.mu.Unlock()
	}()
	jsonResponses := map[string]bool{}

	for {
		select {
		case <-stop:
			return
		case msg, ok := <-conn.events:
			if !ok {
				return
			}
			switch msg.Method {
			case "Network.requestWillBeSent":
				var params struct {
					RequestID string `json:"requestId"`
					Request   struct {
						URL      string            `json:"url"`
						Method   string            `json:"method"`
						Headers  map[string]string `json:"headers"`
						PostData string            `json:"postData"`
					} `json:"request"`
				}
				if json.Unmarshal(msg.Params, &params) == nil {
					c.record(params.RequestID, params.Request.Method, params.Request.URL,
						params.Request.Headers, params.Request.PostData)
				}

			case "Network.responseReceived":
				var params struct {
					RequestID string `json:"requestId"`
					Response  struct {
						MimeType string `json:"mimeType"`
					} `json:"response"`
				}
				if json.Unmarshal(msg.Params, &params) == nil &&
					readableBody(params.Response.MimeType) {
					jsonResponses[params.RequestID] = true
				}

			case "Network.webSocketFrameReceived":
				var params struct {
					Response struct {
						PayloadData string `json:"payloadData"`
					} `json:"response"`
				}
				if json.Unmarshal(msg.Params, &params) == nil {
					c.absorbFrame(params.Response.PayloadData)
				}

			case "Network.loadingFinished":
				var params struct {
					RequestID string `json:"requestId"`
				}
				if json.Unmarshal(msg.Params, &params) != nil || !jsonResponses[params.RequestID] {
					continue
				}
				delete(jsonResponses, params.RequestID)
				// بدنه را در گوروتین جدا می‌گیریم تا خواندن رویدادها نایستد.
				go c.fetchBody(conn, params.RequestID)
			}
		}
	}
}

// readableBody می‌گوید ارزش دارد بدنهٔ این پاسخ را بگیریم یا نه.
//
// فقط به JSON بسنده نمی‌کنیم: بعضی سرورها فهرست را با نوع متنی یا نامشخص
// می‌فرستند و آن‌وقت هیچ‌وقت دیده نمی‌شد.
func readableBody(mimeType string) bool {
	lower := strings.ToLower(mimeType)
	for _, skip := range []string{"image/", "font/", "video/", "audio/", "text/css",
		"javascript", "text/html", "application/wasm"} {
		if strings.Contains(lower, skip) {
			return false
		}
	}
	return true
}

// fetchBody پاسخ یک درخواست را می‌گیرد و با آن، نوعش را تشخیص می‌دهد.
func (c *Capturer) fetchBody(conn *cdpConn, requestID string) {
	result, err := conn.Call("Network.getResponseBody", map[string]interface{}{"requestId": requestID})
	if err != nil {
		return
	}
	var payload struct {
		Body          string `json:"body"`
		Base64Encoded bool   `json:"base64Encoded"`
	}
	if json.Unmarshal(result, &payload) != nil {
		return
	}
	body := payload.Body
	if payload.Base64Encoded {
		decoded, err := base64.StdEncoding.DecodeString(body)
		if err != nil {
			return
		}
		body = string(decoded)
	}
	// فهرست کامل نمادهای بازار چند مگابایت است؛ بریدنش یعنی JSON خراب.
	if len(body) > 16<<20 {
		body = body[:16<<20]
	}
	c.classifyResponse(requestID, body)
}

var isinRe = regexp.MustCompile(`\bIR[A-Z0-9]{10}\b`)

// مسیرهایی که فهرست کل نمادهای بازار را می‌دهند.
// شاخص‌های بورس با IRX شروع می‌شوند؛ قابل معامله نیستند و اگر وارد جدول شوند
// هم جست‌وجو را شلوغ می‌کنند و هم جدول را «پر» نشان می‌دهند.
var indexISINRe = regexp.MustCompile(`^(?i)IRX`)

var serverTimePathRe = regexp.MustCompile(`(?i)(server-?time|servertime|time/now|systemtime)`)

var symbolListPathRe = regexp.MustCompile(
	`(?i)(symbols?/all|instruments?/(all|list)|symbol-?list|all-?symbols|bootstrap/instruments)`)

// record یک درخواست دیده‌شده را ثبت می‌کند.
func (c *Capturer) record(requestID, method, rawURL string, headers map[string]string, postData string) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" || isStaticAsset(parsed.Path) {
		return
	}

	authorization := ""
	for name, value := range headers {
		if strings.EqualFold(name, "authorization") && strings.TrimSpace(value) != "" {
			authorization = value
		}
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if authorization != "" {
		token := strings.TrimSpace(strings.TrimPrefix(
			strings.TrimPrefix(authorization, "Bearer"), "bearer"))
		if token != "" {
			c.token = token
			origin := parsed.Scheme + "://" + parsed.Host
			c.hosts[parsed.Host] = true
			// نشانی پایه را فقط یک‌بار می‌نشانیم: کارگزاری چند میزبان دارد
			// (دروازه، OMS، نمادها…) و اگر هر بار بازنویسی شود، آخرین
			// میزبانِ دیده‌شده جای همه را می‌گیرد.
			if c.apiBase == "" {
				c.apiBase = origin
			}
		}
	}

	entry := CapturedRequest{
		ID:       requestID,
		Method:   method,
		URL:      rawURL,
		Path:     parsed.Path,
		PostData: postData,
		Headers:  headers,
		Kind:     "other",
		At:       time.Now(),
	}
	// سفارش را از روی بدنهٔ خودِ درخواست می‌شناسیم؛ پاسخش لازم نیست.
	if method == "POST" && looksLikeOrderBody(postData) {
		entry.Kind = "order"
		copied := entry
		c.order = &copied
	}
	// درخواست «فهرست کل نمادها» را هم از روی مسیرش می‌شناسیم. این درخواست
	// معمولاً یک هشِ کش همراه دارد و اگر فهرست عوض نشده باشد، سرور چیزی
	// نمی‌فرستد و وب‌اپ از کش خودش می‌خواند — پس ما هیچ‌وقت فهرست را نمی‌بینیم
	// مگر اینکه خودمان با هش خالی دوباره بخواهیمش.
	// ساعت سرور کارگزار: دقیق‌ترین مرجع ممکن برای سرخطی، چون همان ساعتی است
	// که سفارش با آن سنجیده می‌شود.
	if method == "GET" && serverTimePathRe.MatchString(parsed.Path) {
		entry.Kind = "server-time"
		copied := entry
		c.serverTime = &copied
	}
	if method != "OPTIONS" && symbolListPathRe.MatchString(parsed.Path) {
		entry.Kind = "symbol-list"
		copied := entry
		c.symbolList = &copied
	}

	c.requests = append(c.requests, entry)
	if len(c.requests) > 300 {
		trimmed := c.requests[len(c.requests)-300:]
		c.requests = append([]CapturedRequest(nil), trimmed...)
		// شماره‌ها جابه‌جا شده‌اند؛ نگاشت را از نو می‌سازیم.
		c.byIndex = make(map[string]int, len(c.requests))
		for i := range c.requests {
			c.byIndex[c.requests[i].ID] = i
		}
	}
	c.byIndex[requestID] = len(c.requests) - 1
}

// classifyResponse با دیدن پاسخ، نوع درخواست را تعیین می‌کند.
func (c *Capturer) classifyResponse(requestID, body string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	index, ok := c.byIndex[requestID]
	if !ok || index >= len(c.requests) {
		return
	}
	entry := &c.requests[index]
	if len(body) > 400 {
		entry.Preview = body[:400] + "…"
	} else {
		entry.Preview = body
	}

	// هر پاسخی که فهرستی از نمادها دارد، جدول نمادها را پر می‌کند — چه پاسخ
	// یک جست‌وجو باشد و چه فهرست کاملی که وب‌اپ هنگام ورود می‌گیرد.
	if hits := extractSymbols(json.RawMessage(body)); len(hits) >= 8 {
		c.mergeSymbols(hits)
	}

	// اطلاعات نماد: خودِ درخواست یک ISIN مشخص می‌خواهد و پاسخ سقف و کف دارد.
	// شرط را به وجود ISIN در *پاسخ* گره نمی‌زنیم؛ خیلی از کارگزاری‌ها کد نماد
	// را در پاسخ تکرار نمی‌کنند.
	if hasBandNumbers(body) {
		if endpoint, ok := buildEndpointWithHeaders(entry.Method, entry.URL, entry.PostData,
			entry.Headers, true); ok {
			entry.Kind = "instrument"
			c.addInstrument(&endpoint)
			return
		}
	}

	// جست‌وجو: درخواست یک عبارت کوتاه تایپ‌شده دارد و پاسخ یا خودِ آن عبارت را
	// برگردانده یا کد نمادی در آن هست.
	//
	// «پاسخ شامل همان عبارت» قوی‌ترین نشانه است: نتیجهٔ جست‌وجوی «تابان» حتماً
	// کلمهٔ «تابان» را در خود دارد، حتی اگر کارگزار اصلاً کد ISIN برنگرداند.
	endpoint, ok := buildEndpointWithHeaders(entry.Method, entry.URL, entry.PostData,
		entry.Headers, false)
	if !ok {
		return
	}
	if !bodyMentions(body, endpoint.Sample) && len(isinRe.FindAllString(body, 2)) == 0 {
		return
	}
	entry.Kind = "search"
	c.search = &endpoint
}

// bodyMentions می‌گوید عبارت جست‌وجوشده در پاسخ آمده یا نه.
//
// بعضی سرورها فارسی را خام می‌فرستند و بعضی به شکل \uXXXX؛ هر دو را می‌بینیم.
func bodyMentions(body, term string) bool {
	term = strings.TrimSpace(term)
	if term == "" || len(body) == 0 {
		return false
	}
	if strings.Contains(body, term) {
		return true
	}
	var escaped strings.Builder
	for _, r := range term {
		if r < 128 {
			escaped.WriteRune(r)
		} else {
			fmt.Fprintf(&escaped, "\\u%04x", r)
		}
	}
	return strings.Contains(strings.ToLower(body), strings.ToLower(escaped.String()))
}

// absorbFrame یک فریم وب‌سوکت را برای پیدا کردن نماد می‌کاود.
func (c *Capturer) absorbFrame(payload string) {
	if len(payload) < 40 || len(payload) > 8<<20 {
		return
	}
	hits := extractSymbols(json.RawMessage(payload))
	if len(hits) < 8 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.mergeSymbols(hits)
}

// addInstrument یک منبع اطلاعات نماد را اضافه می‌کند.
//
// چند منبع نگه می‌داریم چون هیچ‌کدام همهٔ اعداد را ندارند: یکی سقف و کف
// قیمت می‌دهد و دیگری حداکثر حجم مجاز.
func (c *Capturer) addInstrument(endpoint *Endpoint) {
	for _, existing := range c.instruments {
		if existing.URL == endpoint.URL {
			return
		}
	}
	c.instruments = append(c.instruments, endpoint)
	if len(c.instruments) > 4 {
		c.instruments = c.instruments[len(c.instruments)-4:]
	}
	if c.instrument == nil {
		c.instrument = endpoint
	}
}

// InstrumentEndpoints همهٔ منابع اطلاعات نماد.
func (c *Capturer) InstrumentEndpoints() []*Endpoint {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.instruments) == 0 && c.instrument != nil {
		return []*Endpoint{c.instrument}
	}
	return append([]*Endpoint(nil), c.instruments...)
}

// mergeSymbols نمادهای تازه را به جدول اضافه می‌کند.
func (c *Capturer) mergeSymbols(hits []SymbolHit) {
	for _, hit := range hits {
		if hit.Symbol == "" || hit.ISIN == "" || indexISINRe.MatchString(hit.ISIN) {
			continue
		}
		if _, exists := c.symbols[hit.ISIN]; !exists {
			c.symbols[hit.ISIN] = hit
			c.dirty = true
		}
	}
	// سقف محافظه‌کارانه: کل بازار ایران حدود ده هزار نماد است.
	if len(c.symbols) > 80_000 {
		c.symbols = make(map[string]SymbolHit)
	}
}

// ServerTimeRequest درخواستی که ساعت سرور کارگزار را می‌دهد.
func (c *Capturer) ServerTimeRequest() *CapturedRequest {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.serverTime
}

// SymbolListRequest درخواستی که فهرست کل نمادها را می‌دهد (اگر دیده شده باشد).
func (c *Capturer) SymbolListRequest() *CapturedRequest {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.symbolList
}

// Symbols نسخه‌ای از جدول نمادها.
func (c *Capturer) Symbols() []SymbolHit {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]SymbolHit, 0, len(c.symbols))
	for _, hit := range c.symbols {
		out = append(out, hit)
	}
	return out
}

// LoadSymbols جدول ذخیره‌شدهٔ اجرای قبلی را برمی‌گرداند.
func (c *Capturer) LoadSymbols(hits []SymbolHit) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, hit := range hits {
		if hit.ISIN != "" && hit.Symbol != "" {
			c.symbols[hit.ISIN] = hit
		}
	}
	c.dirty = false
}

// MergeTsetmc نتیجهٔ گرفتن فهرست از TSETMC را می‌نشاند.
func (c *Capturer) MergeTsetmc(hits []SymbolHit, prices map[string]TsePrice, source string, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.tsetmcAt = time.Now()
	if err != nil {
		c.tsetmcError = err.Error()
		return
	}
	c.tsetmcError = ""
	c.tsetmcSource = source
	c.tsetmcCount = len(hits)
	c.mergeSymbols(hits)
	for isin, price := range prices {
		c.prices[isin] = price
	}
	if len(hits) > 500 {
		c.fullList = true
	}
}

// PriceOf قیمت تابلوی یک نماد از TSETMC.
func (c *Capturer) PriceOf(isin string) (TsePrice, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	price, ok := c.prices[isin]
	return price, ok
}

// MarkFullList ثبت می‌کند که فهرست کامل بازار گرفته شده.
func (c *Capturer) MarkFullList() {
	c.mu.Lock()
	c.fullList = true
	c.mu.Unlock()
}

// TakeDirty می‌گوید از آخرین ذخیره، نماد تازه‌ای اضافه شده یا نه.
func (c *Capturer) TakeDirty() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	dirty := c.dirty
	c.dirty = false
	return dirty
}

// hasBandNumbers می‌گوید این پاسخ، سقف و کف مجاز قیمت را دارد یا نه.
func hasBandNumbers(body string) bool {
	fields := numbersByKey(json.RawMessage(body))
	return pickNumber(fields, upperPatterns) > 0 && pickNumber(fields, lowerPatterns) > 0
}

func isStaticAsset(path string) bool {
	lower := strings.ToLower(path)
	for _, suffix := range []string{".js", ".css", ".png", ".jpg", ".jpeg", ".svg",
		".gif", ".woff", ".woff2", ".ttf", ".ico", ".map", ".webp", ".html"} {
		if strings.HasSuffix(lower, suffix) {
			return true
		}
	}
	return false
}

// Status خلاصهٔ آنچه تا حالا یاد گرفته شده.
func (c *Capturer) Status() CaptureStatus {
	c.mu.Lock()
	defer c.mu.Unlock()

	status := CaptureStatus{
		BrowserRunning: c.browser != nil && c.browser.Running(),
		APIBase:        c.apiBase,
		Seen:           len(c.requests),
		LoggedIn:       c.token != "",
		CanSearch:      c.search != nil || len(c.symbols) > 0,
		SymbolCount:    len(c.symbols),
		CanListSymbols: c.symbolList != nil,
		CanBrokerTime:  c.serverTime != nil,
		SymbolsFull:    c.fullList,
		TsetmcCount:    c.tsetmcCount,
		TsetmcSource:   c.tsetmcSource,
		TsetmcError:    c.tsetmcError,
		CanQuote:       c.instrument != nil,
		CanOrder:       c.order != nil,
		Profile:        c.profile,
	}
	if c.token != "" {
		status.TokenPreview = previewToken(c.token)
		if expiry, ok := jwtExpiry(c.token); ok {
			status.TokenExpiresAt = expiry.In(Tehran()).Format("15:04:05")
			remaining := time.Until(expiry)
			status.TokenExpired = remaining <= 0
			status.TokenTTL = humanDuration(remaining)
		}
	}
	if c.order != nil {
		status.OrderPath = c.order.Path
		status.OrderURL = c.order.URL
		if shape, ok := BuildOrderShape(c.order.PostData); ok {
			status.OrderTemplate = shape.Template
		}
	}
	if c.search != nil {
		status.SearchURL = c.search.URL
	}
	if c.instrument != nil {
		status.InstrumentURL = c.instrument.URL
	}
	status.Ready = status.LoggedIn && status.CanOrder
	status.Hint = c.hint()
	return status
}

// hint می‌گوید کاربر برای کامل شدن یادگیری چه کاری باید بکند.
func (c *Capturer) hint() string {
	switch {
	case c.browser == nil && c.token == "":
		return "برای شروع، «باز کردن ایزی‌تریدر» را بزنید."
	case c.token == "":
		return "در پنجرهٔ ایزی‌تریدر وارد حساب خود شوید."
	case c.search == nil && len(c.symbols) == 0 && c.tsetmcError != "":
		return "گرفتن فهرست نمادها از TSETMC ناموفق بود: " + c.tsetmcError
	case c.search == nil && len(c.symbols) == 0 && c.symbolList != nil:
		return "فهرست نمادها آماده است؛ دکمهٔ «گرفتن فهرست نمادها» را بزنید."
	case c.search == nil && len(c.symbols) == 0:
		return "در ایزی‌تریدر نمادی را جست‌وجو یا باز کنید تا فهرست نمادها به دست بیاید."
	case c.instrument == nil:
		return "یک نماد را در ایزی‌تریدر باز کنید تا سقف و کف قیمت یاد گرفته شود."
	case c.order == nil:
		return "یک‌بار سفارشی با قیمتی دور از بازار ثبت کنید تا قالب سفارش یاد گرفته شود (بعد لغوش کنید)."
	default:
		return "همه‌چیز یاد گرفته شد؛ آمادهٔ سرخطی."
	}
}

// Learned تنظیمات یادگرفته‌شده را روی پیکربندی می‌نشاند.
func (c *Capturer) Learned(cfg Config) Config {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.apiBase != "" {
		cfg.BaseURL = c.apiBase
	}
	if c.token != "" {
		cfg.Token = c.token
	}
	if c.order != nil {
		cfg.OrderPath = c.order.Path
		cfg.OrderURL = c.order.URL
		if shape, ok := BuildOrderShape(c.order.PostData); ok {
			cfg.PayloadTemplate = shape.Template
			cfg.OrderDateSample = shape.DateSample
			cfg.OrderCommission = shape.Commission
			// کد سمت را از همان سفارش واقعی برمی‌داریم؛ حدس زدنش یعنی
			// فرستادن سفارش با سمت اشتباه.
			if shape.SideSample != "" {
				cfg.SideBuy, cfg.SideSell = sideCodesFrom(shape.SideSample, cfg.SideCapturedIsSell)
			}
		}
		if headers := replayableHeaders(c.order.Headers); headers != nil {
			cfg.OrderHeaders = headers
		}
	}
	cfg.SearchEndpoint = c.search
	cfg.InstrumentEndpoint = c.instrument
	return cfg
}

// Forget هرچه از کارگزاری یاد گرفته شده را پاک می‌کند.
//
// جدول نمادها می‌ماند (از tsetmc و مستقل از حساب است)، ولی توکن، نشانی سفارش
// و قالب بدنه می‌روند: وقتی به حساب یا کارگزاری دیگری سوئیچ می‌کنید، ماندنِ
// این‌ها یعنی فرستادن سفارش به جای اشتباه با توکن اشتباه.
func (c *Capturer) Forget() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.token, c.apiBase = "", ""
	c.order, c.search, c.instrument = nil, nil, nil
	c.instruments = nil
	c.symbolList, c.serverTime = nil, nil
	c.requests = nil
	c.byIndex = make(map[string]int)
	c.hosts = make(map[string]bool)
}

func (c *Capturer) Token() (string, string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.token, c.apiBase
}

// KnownHost می‌گوید این میزبان از همان کارگزاری است یا نه.
func (c *Capturer) KnownHost(host string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.hosts[host]
}

func (c *Capturer) endpointOf(kind string) *Endpoint {
	c.mu.Lock()
	defer c.mu.Unlock()
	if kind == "search" {
		return c.search
	}
	return c.instrument
}

// Requests فهرست درخواست‌های دیده‌شده (تازه‌ترین اول) برای انتخاب دستی.
//
// هر مسیر فقط یک‌بار می‌آید: صفحهٔ کارگزاری یک مسیر را صدها بار صدا می‌زند
// (قیمت لحظه‌ای) و بدون یکتاسازی، فهرست پر از تکرار و بی‌فایده می‌شود.
func (c *Capturer) Requests() []CapturedRequest {
	c.mu.Lock()
	defer c.mu.Unlock()

	seen := map[string]bool{}
	out := make([]CapturedRequest, 0, 60)
	for i := len(c.requests) - 1; i >= 0 && len(out) < 60; i-- {
		entry := c.requests[i]
		key := entry.Method + " " + entry.Path
		if seen[key] {
			continue
		}
		seen[key] = true
		entry.Headers = nil // هدرها توکن دارند؛ به رابط کاربری نمی‌روند
		out = append(out, entry)
	}
	return out
}

// UseAs یک درخواست دیده‌شده را دستی به‌عنوان جست‌وجو/اطلاعات/سفارش ثبت می‌کند.
func (c *Capturer) UseAs(rawURL, kind string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i := len(c.requests) - 1; i >= 0; i-- {
		if c.requests[i].URL != rawURL {
			continue
		}
		entry := c.requests[i]
		switch kind {
		case "order":
			entry.Kind = "order"
			c.order = &entry
			return nil
		case "search", "instrument":
			endpoint, ok := buildEndpointWithHeaders(entry.Method, entry.URL, entry.PostData,
				entry.Headers, kind == "instrument")
			if !ok {
				if kind == "instrument" {
					return fmt.Errorf("در این درخواست جای کد ISIN پیدا نشد")
				}
				return fmt.Errorf("در این درخواست جای عبارت جست‌وجو پیدا نشد")
			}
			entry.Kind = kind
			c.requests[i] = entry
			if kind == "search" {
				c.search = &endpoint
			} else {
				c.addInstrument(&endpoint)
			}
			return nil
		default:
			return fmt.Errorf("نوع نامعتبر: %s", kind)
		}
	}
	return fmt.Errorf("این درخواست دیگر در فهرست نیست")
}

func (c *Capturer) Stop() {
	c.mu.Lock()
	if c.stop != nil {
		close(c.stop)
		c.stop = nil
	}
	conns := c.conns
	c.conns = make(map[string]*cdpConn)
	browser := c.browser
	c.browser = nil
	c.mu.Unlock()

	for _, conn := range conns {
		conn.Close()
	}
	browser.Close()
}

// ---------------------------------------------------------------- ابزارها

// humanDuration مدت باقی‌مانده را به شکل خوانا می‌نویسد.
func humanDuration(d time.Duration) string {
	switch {
	case d <= 0:
		return "منقضی شده"
	case d < time.Hour:
		return fmt.Sprintf("%d دقیقه", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%d ساعت", int(d.Hours()))
	default:
		return fmt.Sprintf("%d روز", int(d.Hours()/24))
	}
}

func previewToken(token string) string {
	if len(token) <= 14 {
		return "••••"
	}
	return token[:8] + "…" + token[len(token)-6:]
}

// jwtExpiry تاریخ انقضای توکن را از خودِ توکن می‌خواند (محلی، بدون ارسال جایی).
func jwtExpiry(token string) (time.Time, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return time.Time{}, false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return time.Time{}, false
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil || claims.Exp == 0 {
		return time.Time{}, false
	}
	return time.Unix(claims.Exp, 0), true
}

// numbersByKey همهٔ عددهای یک JSON را با نام کلیدشان صاف می‌کند.
func numbersByKey(raw json.RawMessage) map[string]float64 {
	out := map[string]float64{}
	var walk func(prefix string, value interface{})
	walk = func(prefix string, value interface{}) {
		switch typed := value.(type) {
		case map[string]interface{}:
			for key, child := range typed {
				walk(key, child)
			}
		case []interface{}:
			for _, child := range typed {
				walk(prefix, child)
			}
		case float64:
			if _, exists := out[prefix]; !exists {
				out[prefix] = typed
			}
		case string:
			if number, err := parseNumber(typed); err == nil {
				if _, exists := out[prefix]; !exists {
					out[prefix] = number
				}
			}
		}
	}
	var decoded interface{}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return out
	}
	walk("", decoded)
	return out
}
