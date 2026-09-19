package main

import (
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed ui.html
var uiFiles embed.FS

// Server رابط کاربری وب روی 127.0.0.1 را سرو می‌کند.
//
// سرور فقط به لوکال‌هاست گوش می‌دهد و هر فراخوانی API به توکن تصادفیِ همان
// اجرا نیاز دارد. بدون این، یک صفحهٔ وب بازِ دیگر در همان مرورگر می‌توانست
// به این سرور دستور ثبت سفارش بدهد.
type Server struct {
	engine     *Engine
	capturer   *Capturer
	token      string
	configPath string

	mu             sync.Mutex
	config         Config
	configVersion  string // نسخه‌ای که فایل تنظیمات با آن نوشته شده
	saveError      string // آخرین خطای ذخیره؛ در رابط کاربری دیده می‌شود
	limits         Limits
	limitsISIN     string
	refreshing     bool
	lastRefreshTry time.Time
	shutdownCh     chan struct{}
}

func NewServer(configPath string) (*Server, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	s := &Server{
		engine:     NewEngine(),
		capturer:   NewCapturer(),
		token:      hex.EncodeToString(buf),
		configPath: configPath,
		config:     DefaultConfig(),
		shutdownCh: make(chan struct{}),
	}
	s.engine.BrokerClock = s.capturer.BrokerClock
	// پوشهٔ فایل تنظیمات ممکن است وجود نداشته باشد (مثلاً مسیر دستی با ‎--config)؛
	// بدون این، هر ذخیره‌سازی با خطای «پوشه پیدا نشد» رد می‌شد.
	if dir := filepath.Dir(configPath); dir != "" {
		os.MkdirAll(dir, 0o700)
	}
	if target, moved := MigrateLegacyConfig(); moved {
		s.engine.logf("تنظیمات قبلی به پوشهٔ نوشتنی منتقل شد: %s", target)
	}
	s.loadConfig()
	s.loadSymbols()
	go s.refreshTsetmc() // هر بار که برنامه بالا می‌آید، فهرست تازه
	// آنچه در اجرای قبلی یاد گرفته شده را برمی‌گردانیم تا این بار فقط ورود لازم باشد.
	s.capturer.Seed(s.config.SearchEndpoint, s.config.InstrumentEndpoint,
		s.config.OrderURL, s.config.OrderPath, s.config.PayloadTemplate, s.config.BaseURL)
	return s, nil
}

func (s *Server) loadConfig() {
	data, err := os.ReadFile(s.configPath)
	if err != nil {
		return
	}
	cfg := DefaultConfig()
	if err := json.Unmarshal(data, &cfg); err != nil {
		return
	}
	s.configVersion = strings.TrimSpace(cfg.Version)
	// نماد هم بازیابی نمی‌شود: هر اجرا باید آگاهانه انتخاب شود، وگرنه ممکن است
	// ندانسته روی نمادِ دیروز مسلح شوید.
	cfg.Symbol, cfg.SymbolName, cfg.ISIN = "", "", ""
	// مسیر سفارشِ بدون نشانی کامل، یادگاریِ نسخه‌های قدیمی است و کار نمی‌کند.
	if strings.TrimSpace(cfg.OrderURL) == "" {
		cfg.OrderPath, cfg.PayloadTemplate = "", ""
	}
	s.config = cfg
}

// symbolsPath فایل جدول نمادها، کنار فایل تنظیمات.
func (s *Server) symbolsPath() string {
	return strings.TrimSuffix(s.configPath, ".json") + "-symbols.json"
}

func (s *Server) loadSymbols() {
	data, err := os.ReadFile(s.symbolsPath())
	if err != nil {
		return
	}
	var hits []SymbolHit
	if json.Unmarshal(data, &hits) == nil {
		s.capturer.LoadSymbols(hits)
	}
}

// saveSymbols جدول نمادها را نگه می‌دارد تا دفعهٔ بعد جست‌وجو از همان اول کار کند.
func (s *Server) saveSymbols() {
	if !s.capturer.TakeDirty() {
		return
	}
	hits := s.capturer.Symbols()
	if len(hits) == 0 {
		return
	}
	data, err := json.Marshal(hits)
	if err != nil {
		return
	}
	os.WriteFile(s.symbolsPath(), data, 0o600)
}

func (s *Server) saveConfig() error {
	s.mu.Lock()
	s.config.Version = AppVersion
	cfg := s.config
	s.mu.Unlock()
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	err = os.WriteFile(s.configPath, data, 0o600)
	// خطای ذخیره دیگر بی‌صدا نمی‌ماند: روی کامپیوتری که پوشهٔ برنامه نوشتنی
	// نیست، همین یک خطا باعث می‌شد هر بار همه‌چیز از صفر شروع شود و هیچ‌جا
	// معلوم نبود چرا.
	s.mu.Lock()
	if err != nil {
		s.saveError = fmt.Sprintf("تنظیمات ذخیره نشد (%s): %v", s.configPath, err)
	} else {
		s.saveError = ""
	}
	note := s.saveError
	s.mu.Unlock()
	if note != "" {
		s.engine.logf("✗ %s", note)
	}
	return err
}

// current پیکربندی جاری را با هر چیزی که از ایزی‌تریدر یاد گرفته‌ایم ترکیب می‌کند.
func (s *Server) current() Config {
	s.mu.Lock()
	cfg := s.config
	s.mu.Unlock()
	return s.capturer.Learned(cfg)
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/api/state", s.guard(s.handleState))
	mux.HandleFunc("/api/config", s.guard(s.handleConfig))
	mux.HandleFunc("/api/browser", s.guard(s.handleBrowser))
	mux.HandleFunc("/api/browser/stop", s.guard(s.handleBrowserStop))
	mux.HandleFunc("/api/search", s.guard(s.handleSearch))
	mux.HandleFunc("/api/instrument", s.guard(s.handleInstrument))
	mux.HandleFunc("/api/captured", s.guard(s.handleCaptured))
	mux.HandleFunc("/api/use-as", s.guard(s.handleUseAs))
	mux.HandleFunc("/api/import-curl", s.guard(s.handleImportCurl))
	mux.HandleFunc("/api/diagnostics", s.guard(s.handleDiagnostics))
	mux.HandleFunc("/api/symbols/refresh", s.guard(s.handleRefreshSymbols))
	mux.HandleFunc("/api/symbols/tsetmc", s.guard(s.handleTsetmc))
	mux.HandleFunc("/api/symbols/tsetmc/test", s.guard(s.handleTsetmcTest))
	mux.HandleFunc("/api/sync", s.guard(s.handleSync))
	mux.HandleFunc("/api/check", s.guard(s.handleCheck))
	mux.HandleFunc("/api/arm", s.guard(s.handleArm))
	mux.HandleFunc("/api/send-now", s.guard(s.handleSendNow))
	mux.HandleFunc("/api/cancel", s.guard(s.handleCancel))
	mux.HandleFunc("/api/log", s.guard(s.handleLog))
	mux.HandleFunc("/api/quit", s.guard(s.handleQuit))
	mux.HandleFunc("/api/selftest", s.guard(s.handleSelfTest))
	mux.HandleFunc("/api/config/defaults", s.guard(s.handleConfigDefaults))
	mux.HandleFunc("/api/config/reset", s.guard(s.handleConfigReset))
	mux.HandleFunc("/api/config/export", s.guard(s.handleConfigExport))
	mux.HandleFunc("/api/config/import", s.guard(s.handleConfigImport))
	mux.HandleFunc("/api/accounts/add", s.guard(s.handleAccountAdd))
	mux.HandleFunc("/api/accounts/open", s.guard(s.handleAccountOpen))
	mux.HandleFunc("/api/accounts/capture", s.guard(s.handleAccountCapture))
	mux.HandleFunc("/api/accounts/update", s.guard(s.handleAccountUpdate))
	mux.HandleFunc("/api/accounts/delete", s.guard(s.handleAccountDelete))
	return mux
}

func (s *Server) guard(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Sarkhati-Token")), []byte(s.token)) != 1 {
			http.Error(w, "توکن نامعتبر", http.StatusForbidden)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" &&
			!strings.Contains(origin, "127.0.0.1") && !strings.Contains(origin, "localhost") {
			http.Error(w, "منبع نامعتبر", http.StatusForbidden)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		next(w, r)
	}
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	page, err := uiFiles.ReadFile("ui.html")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// توکن این اجرا داخل صفحه تزریق می‌شود تا در نشانی و تاریخچهٔ مرورگر نماند.
	page = []byte(strings.Replace(string(page), "__TOKEN__", s.token, 1))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(page)
}

func writeJSON(w http.ResponseWriter, value interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(value)
}

func fail(w http.ResponseWriter, err error) {
	writeJSON(w, map[string]interface{}{"ok": false, "error": err.Error()})
}

// readConfig پیکربندی ارسالی رابط کاربری را می‌گیرد و ذخیره می‌کند.
func (s *Server) readConfig(r *http.Request) (Config, error) {
	var incoming Config
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil && err.Error() != "EOF" {
			return Config{}, err
		}
	}
	clickAgo := incoming.ClickAgoMs
	incoming.ClickAgoMs = 0 // موقتی است و در فایل تنظیمات ذخیره نمی‌شود
	s.mu.Lock()
	if incoming.Mode != "" { // بدنهٔ خالی یعنی «همان تنظیمات فعلی»
		incoming.Token = s.config.Token
		s.config = incoming
	}
	s.mu.Unlock()
	cfg := s.current()
	cfg.ClickAgoMs = clickAgo
	return cfg, nil
}

func (s *Server) handleState(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	limits := s.limits
	s.mu.Unlock()
	s.persistLearned()
	s.saveSymbols()
	s.autoRefreshSymbols()

	s.mu.Lock()
	saveError, configVersion := s.saveError, s.configVersion
	s.mu.Unlock()

	writeJSON(w, map[string]interface{}{
		"config":       s.current(),
		"state":        s.engine.Snapshot(),
		"capture":      s.capturer.Status(),
		"limits":       limits,
		"accounts":     s.accountViews(),
		"server_now":   s.engine.Clock().Now().UnixMilli(),
		"clock_source": s.engine.Clock().Source,
		"paths": map[string]interface{}{
			"config":         s.configPath,
			"data_dir":       DataDir(),
			"data_dir_note":  DataDirNote(),
			"version":        AppVersion,
			"config_version": configVersion,
			"older_version":  configVersion != "" && configVersion != AppVersion,
			"save_error":     saveError,
		},
	})
}

// persistLearned آنچه تازه یاد گرفته شده را در فایل تنظیمات نگه می‌دارد.
func (s *Server) persistLearned() {
	learned := s.capturer.Learned(Config{})
	s.mu.Lock()
	changed := false
	if learned.OrderURL != "" && learned.OrderURL != s.config.OrderURL {
		s.config.OrderURL = learned.OrderURL
		s.config.OrderPath, s.config.PayloadTemplate = learned.OrderPath, learned.PayloadTemplate
		s.config.OrderHeaders = learned.OrderHeaders
		changed = true
	}
	if learned.BaseURL != "" && learned.BaseURL != s.config.BaseURL {
		s.config.BaseURL = learned.BaseURL
		changed = true
	}
	if learned.SearchEndpoint != nil && (s.config.SearchEndpoint == nil ||
		s.config.SearchEndpoint.URL != learned.SearchEndpoint.URL) {
		s.config.SearchEndpoint = learned.SearchEndpoint
		changed = true
	}
	if learned.InstrumentEndpoint != nil && (s.config.InstrumentEndpoint == nil ||
		s.config.InstrumentEndpoint.URL != learned.InstrumentEndpoint.URL) {
		s.config.InstrumentEndpoint = learned.InstrumentEndpoint
		changed = true
	}
	s.mu.Unlock()
	if changed {
		s.saveConfig()
	}
}

func (s *Server) handleImportCurl(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Text string `json:"text"`
		Kind string `json:"kind"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		fail(w, err)
		return
	}
	kind, err := s.capturer.ImportCurl(payload.Text, payload.Kind)
	if err != nil {
		fail(w, err)
		return
	}
	s.persistLearned()
	writeJSON(w, map[string]interface{}{"ok": true, "kind": kind})
}

// handleDiagnostics گزارشی از آنچه برنامه دیده می‌دهد، بدون هیچ توکن یا رمزی.
//
// وقتی تشخیص خودکار جواب نمی‌دهد، این گزارش تنها راه فهمیدن این است که
// کارگزار واقعاً چه چیزی می‌فرستد.
// handleRefreshSymbols فهرست کل نمادها را از کارگزار می‌گیرد.
func (s *Server) handleRefreshSymbols(w http.ResponseWriter, r *http.Request) {
	count, err := s.capturer.RefreshSymbols()
	if err != nil {
		fail(w, err)
		return
	}
	s.saveSymbols()
	s.engine.logf("فهرست نمادها گرفته شد: %s نماد", comma(int64(count)))
	writeJSON(w, map[string]interface{}{"ok": true, "count": count})
}

// autoRefreshSymbols یک‌بار و در پس‌زمینه فهرست را می‌گیرد، به‌محض اینکه
// هم وارد شده باشیم و هم بدانیم فهرست از کجا می‌آید.
func (s *Server) autoRefreshSymbols() {
	status := s.capturer.Status()
	// شرط، «خالی بودن جدول» نیست: چند نماد پراکنده (مثلاً شاخص‌ها) می‌تواند
	// جدول را غیرخالی نشان بدهد و جلوی گرفتن فهرست کامل را بگیرد.
	if !status.LoggedIn || !status.CanListSymbols || status.SymbolsFull {
		return
	}
	s.mu.Lock()
	if s.refreshing || time.Since(s.lastRefreshTry) < 60*time.Second {
		s.mu.Unlock()
		return
	}
	s.refreshing = true
	s.lastRefreshTry = time.Now()
	s.mu.Unlock()

	go func() {
		count, err := s.capturer.RefreshSymbols()
		if err != nil {
			s.engine.logf("گرفتن خودکار فهرست نمادها ناموفق بود: %v", err)
		} else {
			s.saveSymbols()
			s.engine.logf("فهرست نمادها گرفته شد: %s نماد", comma(int64(count)))
		}
		s.mu.Lock()
		s.refreshing = false
		s.mu.Unlock()
	}()
}

// refreshTsetmc فهرست نمادها و قیمت‌ها را از TSETMC می‌گیرد.
func (s *Server) refreshTsetmc() {
	s.mu.Lock()
	enabled, urls := s.config.TsetmcEnabled, s.config.TsetmcURLs
	s.mu.Unlock()
	if !enabled {
		return
	}

	hits, prices, source, err := FetchTSETMC(urls, 45*time.Second)
	s.capturer.MergeTsetmc(hits, prices, source, err)
	if err != nil {
		s.engine.logf("فهرست نمادها از TSETMC گرفته نشد: %v", err)
		return
	}
	s.engine.logf("فهرست نمادها از TSETMC گرفته شد: %s نماد", comma(int64(len(hits))))
	s.saveSymbols()
}

func (s *Server) handleTsetmc(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	urls := s.config.TsetmcURLs
	s.mu.Unlock()

	hits, prices, source, err := FetchTSETMC(urls, 45*time.Second)
	s.capturer.MergeTsetmc(hits, prices, source, err)
	if err != nil {
		fail(w, err)
		return
	}
	s.saveSymbols()
	s.engine.logf("فهرست نمادها از TSETMC گرفته شد: %s نماد", comma(int64(len(hits))))
	writeJSON(w, map[string]interface{}{"ok": true, "count": len(hits), "source": source})
}

// handleTsetmcTest همهٔ نشانی‌های TSETMC را روی همین کامپیوتر امتحان می‌کند.
func (s *Server) handleTsetmcTest(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	urls := s.config.TsetmcURLs
	s.mu.Unlock()

	probes := ProbeTsetmcURLs(urls, 30*time.Second)
	for _, probe := range probes {
		if probe.Error != "" {
			s.engine.logf("TSETMC %s → خطا: %s", probe.URL, probe.Error)
		} else {
			s.engine.logf("TSETMC %s → HTTP %d، %s بایت، %s نماد",
				probe.URL, probe.Status, comma(int64(probe.Bytes)), comma(int64(probe.Symbols)))
		}
	}
	writeJSON(w, map[string]interface{}{"ok": true, "probes": probes})
}

func (s *Server) handleDiagnostics(w http.ResponseWriter, r *http.Request) {
	status := s.capturer.Status()
	status.TokenPreview = ""
	status.APIBase = redactHost(status.APIBase)

	requests := s.capturer.Requests()
	sanitized := make([]map[string]interface{}, 0, len(requests))
	for _, request := range requests {
		sanitized = append(sanitized, map[string]interface{}{
			"method":  request.Method,
			"path":    request.Path,
			"query":   queryKeys(request.URL),
			"kind":    request.Kind,
			"body":    redactSecrets(truncate(request.PostData, 300)),
			"preview": redactSecrets(truncate(request.Preview, 300)),
		})
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="sarkhati-diagnostics.json"`)
	// چند خط آخر گزارش اجرا هم می‌آید: بدون آن، خطاهای گرفتن فهرست نمادها
	// در گزارش تشخیصی دیده نمی‌شود.
	log := s.engine.Snapshot().Log
	if len(log) > 25 {
		log = log[len(log)-25:]
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   status,
		"symbols":  len(s.capturer.Symbols()),
		"log":      log,
		"requests": sanitized,
	})
}

func firstNonZero(values ...float64) float64 {
	for _, value := range values {
		if value != 0 {
			return value
		}
	}
	return 0
}

func truncate(text string, max int) string {
	if len(text) <= max {
		return text
	}
	return text[:max] + "…"
}

// redactSecrets هر رشتهٔ طولانیِ شبیه توکن را از گزارش پاک می‌کند.
func redactSecrets(text string) string {
	return tokenLikeRe.ReplaceAllString(text, "[حذف‌شده]")
}

func redactHost(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		return rawURL
	}
	return parsed.Scheme + "://" + parsed.Host
}

func queryKeys(rawURL string) []string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil
	}
	var keys []string
	for name := range parsed.Query() {
		keys = append(keys, name)
	}
	sort.Strings(keys)
	return keys
}

var tokenLikeRe = regexp.MustCompile(`[A-Za-z0-9_\-]{40,}\.?[A-Za-z0-9_\-.]*`)

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	if _, err := s.readConfig(r); err != nil {
		fail(w, err)
		return
	}
	if err := s.saveConfig(); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true})
}

// ------------------------------------------------------------- مرورگر

func (s *Server) handleBrowser(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.readConfig(r)
	if err != nil {
		fail(w, err)
		return
	}
	portal := strings.TrimSpace(cfg.PortalURL)
	if portal == "" {
		portal = EasyTraderURL
	}
	profile := strings.TrimSpace(r.URL.Query().Get("profile"))
	if err := s.capturer.Start(cfg.BrowserPath, portal, profile); err != nil {
		fail(w, err)
		return
	}
	s.engine.logf("ایزی‌تریدر باز شد؛ در همان پنجره وارد حساب خود شوید")
	writeJSON(w, map[string]interface{}{"ok": true})
}

func (s *Server) handleBrowserStop(w http.ResponseWriter, r *http.Request) {
	s.capturer.Stop()
	writeJSON(w, map[string]interface{}{"ok": true})
}

func (s *Server) handleCaptured(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]interface{}{"ok": true, "requests": s.capturer.Requests()})
}

func (s *Server) handleUseAs(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		URL  string `json:"url"`
		Kind string `json:"kind"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		fail(w, err)
		return
	}
	if err := s.capturer.UseAs(payload.URL, payload.Kind); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true})
}

// -------------------------------------------------------- نماد و محدودیت‌ها

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	term := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(term)) < 1 {
		writeJSON(w, map[string]interface{}{"ok": true, "hits": []SymbolHit{}})
		return
	}
	hits, err := s.capturer.SearchSymbols(term)
	if err != nil {
		s.engine.logf("✗ جست‌وجوی «%s» ناموفق: %v", term, err)
		fail(w, err)
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "hits": hits})
}

func (s *Server) handleInstrument(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		ISIN string `json:"isin"`
	}
	json.NewDecoder(r.Body).Decode(&payload)
	isin := strings.TrimSpace(payload.ISIN)
	if isin == "" {
		fail(w, fmt.Errorf("نماد انتخاب نشده است"))
		return
	}
	s.engine.logf("گرفتن سقف و کف از کارگزار برای %s…", isin)
	limits, err := s.capturer.InstrumentLimits(isin)
	if err != nil {
		s.engine.logf("✗ سقف و کف گرفته نشد: %v", err)
		// حتی اگر کارگزار جواب نداد، قیمت تابلوی TSETMC را نشان می‌دهیم.
		if price, ok := s.capturer.PriceOf(isin); ok {
			limits = Limits{LastPrice: firstNonZero(price.Last, price.Closing), Source: "TSETMC"}
			s.mu.Lock()
			s.limits, s.limitsISIN = limits, isin
			s.mu.Unlock()
			writeJSON(w, map[string]interface{}{"ok": true, "limits": limits,
				"note": "سقف و کف از کارگزار گرفته نشد: " + err.Error()})
			return
		}
		fail(w, err)
		return
	}
	if limits.LastPrice == 0 {
		if price, ok := s.capturer.PriceOf(isin); ok {
			limits.LastPrice = firstNonZero(price.Last, price.Closing)
		}
	}
	s.mu.Lock()
	s.limits = limits
	s.limitsISIN = isin
	s.mu.Unlock()
	s.engine.logf("✓ سقف %s | کف %s | سقف حجم %s",
		comma(int64(limits.UpperPrice)), comma(int64(limits.LowerPrice)),
		comma(int64(limits.MaxQuantity)))
	writeJSON(w, map[string]interface{}{"ok": true, "limits": limits})
}

// freshLimits محدودیت‌های نماد جاری را در صورت نیاز دوباره می‌گیرد.
func (s *Server) freshLimits(cfg Config) Limits {
	s.mu.Lock()
	limits, sameSymbol := s.limits, s.limitsISIN == cfg.ISIN
	s.mu.Unlock()
	if sameSymbol && limits.UpperPrice > 0 {
		return limits
	}
	if cfg.ISIN == "" {
		return limits
	}
	fetched, err := s.capturer.InstrumentLimits(cfg.ISIN)
	if err != nil {
		return limits
	}
	s.mu.Lock()
	s.limits, s.limitsISIN = fetched, cfg.ISIN
	s.mu.Unlock()
	return fetched
}

// ------------------------------------------------------------- اجرا

func (s *Server) handleSync(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.readConfig(r)
	if err != nil {
		fail(w, err)
		return
	}
	clock := s.engine.Sync(cfg.BaseURL)
	writeJSON(w, map[string]interface{}{
		"ok":          true,
		"text":        clock.Describe(),
		"uncertainty": float64(clock.Uncertainty) / float64(time.Millisecond),
	})
}

func (s *Server) handleCheck(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.readConfig(r)
	if err != nil {
		fail(w, err)
		return
	}
	limits := s.freshLimits(cfg)
	problems := cfg.Validate(limits)
	for _, problem := range problems {
		s.engine.logf("✗ بررسی سفارش: %s", problem)
	}
	response := map[string]interface{}{"ok": len(problems) == 0, "problems": problems, "limits": limits}
	if len(problems) == 0 {
		price, _ := cfg.ResolvePrice(limits)
		target := NextOccurrenceAt(s.engine.Clock().Now(), cfg.TargetHour, cfg.TargetMinute,
			cfg.TargetSecond, cfg.TargetMillis)
		response["price"] = price
		response["value"] = price * cfg.Quantity
		response["target"] = target.In(Tehran()).Format("2006-01-02 15:04:05.000")
		if rtts := MeasureRTT(cfg.BaseURL, 4); len(rtts) > 0 {
			median := rtts[len(rtts)/2]
			// همین اندازه‌گیری را نگه می‌داریم؛ اگر بلافاصله مسلح کنید و
			// تا هدف وقتی نمانده باشد، دیگر لازم نیست دوباره اندازه بگیریم.
			s.engine.rememberLead(median / 2)
			response["rtt_ms"] = float64(median) / float64(time.Millisecond)
			response["lead_ms"] = float64(median/2) / float64(time.Millisecond)
		}
	}
	writeJSON(w, response)
}

func (s *Server) handleArm(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.readConfig(r)
	if err != nil {
		fail(w, err)
		return
	}
	s.saveConfig()
	if err := s.engine.Arm(cfg, s.freshLimits(cfg)); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true})
}

func (s *Server) handleSendNow(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.readConfig(r)
	if err != nil {
		fail(w, err)
		return
	}
	s.saveConfig()
	accepted, summary := s.engine.SendNow(cfg, s.freshLimits(cfg))
	writeJSON(w, map[string]interface{}{"ok": accepted, "summary": summary})
}

// handleLog پیامی که رابط کاربری به کاربر نشان داده را در گزارش اجرا ثبت
// می‌کند. بدون این، خطاهای سمت مرورگر هیچ‌وقت در گزارش تشخیصی دیده نمی‌شدند.
func (s *Server) handleLog(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err == nil {
		if text := strings.TrimSpace(payload.Text); text != "" {
			s.engine.logf("[رابط کاربری] %s", truncate(text, 300))
		}
	}
	writeJSON(w, map[string]interface{}{"ok": true})
}

func (s *Server) handleCancel(w http.ResponseWriter, r *http.Request) {
	s.engine.Cancel()
	writeJSON(w, map[string]interface{}{"ok": true})
}

func (s *Server) handleQuit(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]interface{}{"ok": true})
	go func() {
		time.Sleep(200 * time.Millisecond)
		s.capturer.Stop()
		close(s.shutdownCh)
	}()
}

func (s *Server) URL(addr string) string {
	return fmt.Sprintf("http://%s/", addr)
}
