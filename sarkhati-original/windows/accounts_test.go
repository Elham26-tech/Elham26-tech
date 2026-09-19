package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func learnedConfig() Config {
	cfg := baseConfig()
	cfg.Token = "token-main"
	cfg.OrderURL = "https://api.example.com/core/api/v2/order"
	cfg.PayloadTemplate = `{"order":{"price":{price},"quantity":{quantity},"symbolIsin":"{isin}"}}`
	return cfg
}

func readyAccount(name, token, orderURL string) Account {
	return Account{
		ID: name, Name: name, Enabled: true, Profile: name,
		Token: token, OrderURL: orderURL,
		Template: `{"order":{"price":{price},"quantity":{quantity}}}`,
	}
}

// حساب باید مدارک و نشانی خودش را جای حساب اصلی بگذارد، و بقیهٔ سفارش
// (نماد، قیمت، سمت، زمان) دست‌نخورده بماند.
func TestAccountApplyOverridesCredentialsOnly(t *testing.T) {
	cfg := learnedConfig()
	account := readyAccount("دوم", "token-2", "https://other.example.com/order")
	account.Quantity = 2500
	account.SideBuy, account.SideSell = "5", "6"

	out := account.Apply(cfg)
	if out.Token != "token-2" || out.OrderURL != "https://other.example.com/order" {
		t.Errorf("مدارک حساب اعمال نشد: %s %s", out.Token, out.OrderURL)
	}
	if out.Quantity != 2500 {
		t.Errorf("حجم اختصاصی اعمال نشد: %d", out.Quantity)
	}
	if out.SideBuy != "5" {
		t.Errorf("کد سمت حساب اعمال نشد: %s", out.SideBuy)
	}
	if out.Symbol != cfg.Symbol || out.ISIN != cfg.ISIN || out.TargetHour != cfg.TargetHour {
		t.Error("نماد و زمان‌بندی نباید عوض شود")
	}
	if cfg.Token != "token-main" {
		t.Error("پیکربندی اصلی نباید دست‌کاری شود")
	}
}

// حساب غیرفعال، حساب ناقص، و حسابی که همان حساب باز در مرورگر است نباید
// دوباره سفارش بگیرند.
func TestActiveAccountsFilters(t *testing.T) {
	cfg := learnedConfig()
	disabled := readyAccount("خاموش", "token-3", "https://a/order")
	disabled.Enabled = false
	incomplete := Account{ID: "x", Name: "ناقص", Enabled: true}
	duplicate := readyAccount("تکراری", cfg.Token, cfg.OrderURL)
	good := readyAccount("دوم", "token-2", "https://other/order")
	cfg.Accounts = []Account{disabled, incomplete, duplicate, good}

	active := ActiveAccounts(cfg)
	if len(active) != 1 || active[0].Name != "دوم" {
		t.Fatalf("فیلتر حساب‌ها درست کار نکرد: %+v", active)
	}
}

func TestAccountSnapshotNeedsLearnedOrder(t *testing.T) {
	var account Account
	if err := account.Snapshot(Config{}); err == nil {
		t.Error("بدون ورود به حساب نباید ذخیره شود")
	}
	cfg := Config{Token: "t"}
	if err := account.Snapshot(cfg); err == nil {
		t.Error("بدون نشانی و قالب سفارش نباید ذخیره شود")
	}
	if err := account.Snapshot(learnedConfig()); err != nil {
		t.Fatalf("باید ذخیره می‌شد: %v", err)
	}
	if !account.Ready() || account.Missing() != "" {
		t.Errorf("حساب باید آماده باشد: %+v", account)
	}
	if account.View().Token != "" {
		t.Error("توکن نباید به رابط کاربری برود")
	}
}

// دو حساب، دو کارگزار: هر دو باید سفارش بگیرند.
func TestMultiAccountSendsToEveryBroker(t *testing.T) {
	var mainHits, secondHits int64
	mainServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		if r.Method == http.MethodPost {
			atomic.AddInt64(&mainHits, 1)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"isSuccessful":true,"message":"ok"}`))
	}))
	defer mainServer.Close()
	secondServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if r.Method == http.MethodPost {
			atomic.AddInt64(&secondHits, 1)
			if !strings.Contains(string(body), "2500") {
				t.Errorf("حجم اختصاصی حساب دوم نرفت: %s", body)
			}
			if r.Header.Get("Authorization") != "Bearer token-2" {
				t.Errorf("توکن حساب دوم نرفت: %s", r.Header.Get("Authorization"))
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"isSuccessful":true,"message":"ok"}`))
	}))
	defer secondServer.Close()

	cfg := baseConfig()
	cfg.BaseURL = mainServer.URL
	cfg.OrderURL = mainServer.URL + "/core/api/v2/order"
	cfg.Token = "token-main"
	cfg.LeadMs = 0
	cfg.FireMode = FireCount
	cfg.Retries = 1
	cfg.RetryGapMs = MinGapMs
	cfg.MaxDurationS = 10
	cfg.PriceMode = PriceLimit
	cfg.LimitPrice = 5400
	cfg.Connections = 2

	second := readyAccount("حساب دوم", "token-2", secondServer.URL+"/core/api/v2/order")
	second.Quantity = 2500
	cfg.Accounts = []Account{second}

	at := time.Now().In(Tehran()).Add(time.Second)
	cfg.TargetHour, cfg.TargetMinute = at.Hour(), at.Minute()
	cfg.TargetSecond, cfg.TargetMillis = at.Second(), at.Nanosecond()/int(time.Millisecond)

	engine := NewEngine()
	if err := engine.Arm(cfg, bandLimits()); err != nil {
		t.Fatalf("مسلح نشد: %v", err)
	}
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		state := engine.Snapshot()
		if state.Finished {
			if atomic.LoadInt64(&mainHits) == 0 || atomic.LoadInt64(&secondHits) == 0 {
				t.Fatalf("هر دو حساب باید سفارش می‌گرفتند: اصلی %d، دوم %d | %v",
					mainHits, secondHits, state.Log)
			}
			if !strings.Contains(state.Summary, "حساب اصلی") || !strings.Contains(state.Summary, "حساب دوم") {
				t.Errorf("خلاصه باید هر دو حساب را بگوید: %s", state.Summary)
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	engine.Cancel()
	t.Fatalf("اجرا تمام نشد: %v", engine.Snapshot().Log)
}

// توکن منقضیِ یک حساب نباید سرخطیِ بقیه را از بین ببرد.
func TestBrokenAccountDoesNotStopTheRest(t *testing.T) {
	var mainHits int64
	mainServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		if r.Method == http.MethodPost {
			atomic.AddInt64(&mainHits, 1)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"isSuccessful":true,"message":"ok"}`))
	}))
	defer mainServer.Close()

	cfg := baseConfig()
	cfg.BaseURL = mainServer.URL
	cfg.OrderURL = mainServer.URL + "/core/api/v2/order"
	cfg.Token = "token-main"
	cfg.LeadMs = 0
	cfg.FireMode = FireCount
	cfg.Retries = 1
	cfg.RetryGapMs = MinGapMs
	cfg.MaxDurationS = 10
	cfg.PriceMode = PriceLimit
	cfg.LimitPrice = 5400
	cfg.Connections = 1
	// نشانی‌ای که هیچ‌کس در آن گوش نمی‌دهد.
	cfg.Accounts = []Account{readyAccount("خراب", "token-2", "http://127.0.0.1:1/order")}

	at := time.Now().In(Tehran()).Add(time.Second)
	cfg.TargetHour, cfg.TargetMinute = at.Hour(), at.Minute()
	cfg.TargetSecond, cfg.TargetMillis = at.Second(), at.Nanosecond()/int(time.Millisecond)

	engine := NewEngine()
	if err := engine.Arm(cfg, bandLimits()); err != nil {
		t.Fatalf("مسلح نشد: %v", err)
	}
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if state := engine.Snapshot(); state.Finished {
			if !state.Accepted || atomic.LoadInt64(&mainHits) == 0 {
				t.Fatalf("حساب اصلی باید سفارش می‌داد: %s | %v", state.Summary, state.Log)
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	engine.Cancel()
	t.Fatalf("اجرا تمام نشد: %v", engine.Snapshot().Log)
}

// پیش‌فرض‌های نسخهٔ جدید نباید یادگرفته‌ها و حساب‌ها را پاک کند.
func TestFreshDefaultsKeepsLearnedAndAccounts(t *testing.T) {
	cfg := learnedConfig()
	cfg.Accounts = []Account{readyAccount("دوم", "t2", "https://x/order")}
	cfg.RetryGapMs = 500
	cfg.Connections = 1
	cfg.Quantity = 7777

	fresh := cfg.WithFreshDefaults()
	if fresh.RetryGapMs != DefaultConfig().RetryGapMs || fresh.Connections != AutoConnections {
		t.Errorf("عددهای تنظیمی به پیش‌فرض برنگشت: %d %d", fresh.RetryGapMs, fresh.Connections)
	}
	if fresh.OrderURL != cfg.OrderURL || fresh.PayloadTemplate != cfg.PayloadTemplate {
		t.Error("یادگرفته‌ها نباید پاک شود")
	}
	if len(fresh.Accounts) != 1 || fresh.Quantity != 7777 {
		t.Error("حساب‌ها و انتخاب‌های کاربر نباید پاک شود")
	}
	if fresh.Version != AppVersion {
		t.Errorf("نسخه ثبت نشد: %s", fresh.Version)
	}
}

func TestWithoutLearnedClearsBrokerData(t *testing.T) {
	cfg := learnedConfig()
	cfg.Accounts = []Account{readyAccount("دوم", "t2", "https://x/order")}
	bare := cfg.WithoutLearned()
	if bare.OrderURL != "" || bare.Token != "" || bare.PayloadTemplate != "" {
		t.Error("یادگرفته‌ها پاک نشد")
	}
	if len(bare.Accounts) != 1 {
		t.Error("حساب‌های تعریف‌شده نباید با پاک‌کردن یادگرفته‌ها بروند")
	}
}

/* ----------------------------------------- قابلیت حمل روی کامپیوتر دیگر */

func TestWritableDetectsReadOnlyDirectory(t *testing.T) {
	dir := t.TempDir()
	if !Writable(dir) {
		t.Fatal("پوشهٔ موقت باید نوشتنی باشد")
	}
	locked := filepath.Join(dir, "locked")
	if err := os.Mkdir(locked, 0o500); err != nil {
		t.Skipf("ساخت پوشهٔ فقط‌خواندنی ممکن نشد: %v", err)
	}
	if os.Geteuid() == 0 {
		t.Skip("کاربر ریشه همه‌جا می‌نویسد؛ این آزمون معنا ندارد")
	}
	if Writable(locked) {
		t.Error("پوشهٔ فقط‌خواندنی نباید نوشتنی شناخته شود")
	}
}

// اجرای برنامه از داخل فایل فشرده (پوشهٔ موقت) نباید مقصد ذخیره‌سازی باشد.
func TestTemporaryDirIsRecognised(t *testing.T) {
	if !temporaryDir(os.TempDir()) {
		t.Errorf("پوشهٔ موقت شناسایی نشد: %s", os.TempDir())
	}
	if temporaryDir("/opt/sarkhati") {
		t.Error("پوشهٔ عادی نباید موقت شناخته شود")
	}
}

func TestBrowserProfileDirIsSafeAndSeparate(t *testing.T) {
	first := BrowserProfileDir("account-2")
	second := BrowserProfileDir("account-3")
	if first == second {
		t.Error("هر حساب باید پروفایل جدا داشته باشد")
	}
	weird := BrowserProfileDir(`../..\x y`)
	if strings.ContainsAny(filepath.Base(weird), `\/ .`) {
		t.Errorf("نام پوشه پاک‌سازی نشد: %s", weird)
	}
}

func TestSelfTestChecksReportProblems(t *testing.T) {
	if check := checkLearned(Config{}, CaptureStatus{}); check.Level != CheckBad || check.Fix == "" {
		t.Errorf("نبودِ یادگیری باید ایراد جدی باشد: %+v", check)
	}
	cfg := learnedConfig()
	if check := checkLearned(cfg, CaptureStatus{LoggedIn: true}); check.Level != CheckOK {
		t.Errorf("یادگیری کامل باید سالم باشد: %+v", check)
	}
	if check := checkLearned(cfg, CaptureStatus{LoggedIn: true, TokenExpired: true}); check.Level != CheckWarn {
		t.Errorf("توکن منقضی باید هشدار باشد: %+v", check)
	}
	if check := checkConfigFile(filepath.Join(t.TempDir(), "cfg.json")); check.Level != CheckOK {
		t.Errorf("پوشهٔ نوشتنی باید سالم باشد: %+v", check)
	}
	if check := checkConfigFile("/definitely/not/here/cfg.json"); check.Level != CheckBad {
		t.Errorf("پوشهٔ ناموجود باید ایراد باشد: %+v", check)
	}
	report := selfTestReport([]Check{ok("الف", "خوب"), bad("ب", "خراب", "درستش کن")})
	if !strings.Contains(report, "درستش کن") || !strings.Contains(report, AppVersion) {
		t.Errorf("گزارش متنی ناقص است: %s", report)
	}
}
