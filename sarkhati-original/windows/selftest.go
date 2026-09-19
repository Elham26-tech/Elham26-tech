package main

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"strings"
	"time"
)

// عیب‌یابی: چرا روی این کامپیوتر کار نمی‌کند؟
//
// برنامه روی کامپیوتر یکی کار می‌کند و روی کامپیوتر دیگری نه، و تفاوت تقریباً
// همیشه یکی از همین چند چیز است: پوشه‌ای که نمی‌شود در آن نوشت، مرورگری که
// پیدا نمی‌شود، درگاه اشکال‌زدایی‌ای که آنتی‌ویروس بسته، یا شبکه‌ای که به
// کارگزار نمی‌رسد. این فایل همهٔ آن‌ها را روی همان کامپیوتر می‌آزماید و
// می‌گوید کدام‌یک است.

// CheckLevel شدت نتیجهٔ یک آزمون.
const (
	CheckOK   = "ok"
	CheckWarn = "warn"
	CheckBad  = "bad"
)

// Check نتیجهٔ یک آزمون عیب‌یابی.
type Check struct {
	Name   string `json:"name"`
	Level  string `json:"level"`
	Detail string `json:"detail"`
	Fix    string `json:"fix,omitempty"`
}

func ok(name, detail string) Check { return Check{Name: name, Level: CheckOK, Detail: detail} }
func warn(name, detail, fix string) Check {
	return Check{Name: name, Level: CheckWarn, Detail: detail, Fix: fix}
}
func bad(name, detail, fix string) Check {
	return Check{Name: name, Level: CheckBad, Detail: detail, Fix: fix}
}

// SelfTest همهٔ آزمون‌ها را روی همین کامپیوتر اجرا می‌کند.
func SelfTest(cfg Config, status CaptureStatus, configPath string) []Check {
	checks := []Check{
		checkSystem(),
		checkDataDir(),
		checkConfigFile(configPath),
		checkBrowser(cfg.BrowserPath),
		checkDebugPort(),
		checkProxy(),
	}
	checks = append(checks, checkReach("دسترسی به پورتال کارگزاری", portalOf(cfg))...)
	if base := strings.TrimSpace(cfg.BaseURL); base != "" {
		checks = append(checks, checkReach("دسترسی به سرور سفارش‌ها", base)...)
	}
	checks = append(checks, checkTsetmc(), checkLearned(cfg, status), checkClock(cfg))
	return checks
}

func portalOf(cfg Config) string {
	if portal := strings.TrimSpace(cfg.PortalURL); portal != "" {
		return portal
	}
	return EasyTraderURL
}

func checkSystem() Check {
	bits := "۶۴ بیتی"
	if runtime.GOARCH == "386" {
		bits = "۳۲ بیتی"
	}
	return ok("سیستم", fmt.Sprintf("%s %s | نسخهٔ برنامه %s | %s",
		runtime.GOOS, bits, AppVersion, time.Now().In(Tehran()).Format("2006-01-02 15:04:05")))
}

func checkDataDir() Check {
	dir := DataDir()
	if !Writable(dir) {
		return bad("پوشهٔ کاری", dir,
			"هیچ پوشهٔ نوشتنی‌ای پیدا نشد. برنامه را از داخل فایل فشرده اجرا نکنید: "+
				"اول آن را در پوشه‌ای مثل Desktop باز (Extract) کنید و بعد اجرا کنید.")
	}
	return ok("پوشهٔ کاری", fmt.Sprintf("%s — %s", dir, DataDirNote()))
}

func checkConfigFile(path string) Check {
	// آزمون واقعی: یک نوشتن کامل، همان‌طور که هنگام ذخیرهٔ تنظیمات انجام می‌شود.
	probe := path + ".probe"
	if err := os.WriteFile(probe, []byte("{}"), 0o600); err != nil {
		return bad("ذخیرهٔ تنظیمات", err.Error(),
			"ویندوز اجازهٔ نوشتن نمی‌دهد. برنامه را در پوشهٔ Desktop یا Documents بگذارید، "+
				"یا اگر «دسترسی کنترل‌شدهٔ پوشه» روشن است برنامه را در فهرست مجاز آن اضافه کنید.")
	}
	os.Remove(probe)
	if info, err := os.Stat(path); err == nil {
		return ok("ذخیرهٔ تنظیمات", fmt.Sprintf("%s — %d بایت، آخرین تغییر %s",
			path, info.Size(), info.ModTime().In(Tehran()).Format("2006-01-02 15:04")))
	}
	return ok("ذخیرهٔ تنظیمات", path+" — هنوز چیزی ذخیره نشده، ولی پوشه نوشتنی است")
}

func checkBrowser(configured string) Check {
	path := strings.TrimSpace(configured)
	if path == "" {
		found, err := FindBrowser()
		if err != nil {
			return bad("مرورگر", err.Error(),
				"کروم (یا مایکروسافت اج) را نصب کنید، یا مسیر فایل اجرایی مرورگر را "+
					"در بخش «پیشرفته» وارد کنید.")
		}
		path = found
	}
	if _, err := os.Stat(path); err != nil {
		return bad("مرورگر", fmt.Sprintf("«%s» پیدا نشد", path),
			"مسیر مرورگر در بخش «پیشرفته» را درست کنید یا خالی بگذارید تا خودکار پیدا شود.")
	}
	return ok("مرورگر", path)
}

// checkDebugPort می‌آزماید که اصلاً می‌شود روی لوکال‌هاست گوش داد.
//
// روی بعضی کامپیوترها آنتی‌ویروس یا فایروال سازمانی جلوی این را می‌گیرد؛
// آن‌وقت نه رابط کاربری بالا می‌آید و نه کانال کنترل مرورگر.
func checkDebugPort() Check {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return bad("شبکهٔ داخلی (لوکال‌هاست)", err.Error(),
			"آنتی‌ویروس یا فایروال جلوی ارتباط داخلی برنامه را گرفته است؛ "+
				"برنامه را در فهرست مجاز آنتی‌ویروس اضافه کنید.")
	}
	addr := listener.Addr().String()
	listener.Close()
	return ok("شبکهٔ داخلی (لوکال‌هاست)", "پورت محلی باز می‌شود ("+addr+")")
}

func checkProxy() Check {
	var set []string
	for _, key := range []string{"HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY"} {
		if value := os.Getenv(key); value != "" {
			set = append(set, key+"="+value)
		}
	}
	if len(set) == 0 {
		return ok("پروکسی سیستم", "تنظیم نشده — ارسال سفارش مستقیم انجام می‌شود")
	}
	return warn("پروکسی سیستم", strings.Join(set, " | "),
		"ارسال سفارش برای سرعت از سوکت مستقیم استفاده می‌کند و از پروکسیِ متغیرهای محیطی "+
			"رد نمی‌شود. اگر با پروکسی کار می‌کنید، به‌جای آن از وی‌پی‌ان سراسری (TUN) استفاده کنید.")
}

// checkReach رسیدن به یک نشانی را با اندازه‌گیری زمان می‌سنجد.
func checkReach(name, rawURL string) []Check {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		return []Check{bad(name, "نشانی نامعتبر: "+rawURL, "نشانی را در بخش پیشرفته درست کنید.")}
	}
	host := parsed.Hostname()
	port := parsed.Port()
	if port == "" {
		if parsed.Scheme == "http" {
			port = "80"
		} else {
			port = "443"
		}
	}

	// اول خودِ DNS: بیشترِ «اینترنت ندارم»ها در واقع DNS است.
	started := time.Now()
	addrs, err := net.LookupHost(host)
	if err != nil {
		return []Check{bad(name, fmt.Sprintf("نام %s پیدا نشد: %v", host, err),
			"اینترنت یا DNS کار نمی‌کند. اگر با وی‌پی‌ان کار می‌کنید آن را روشن/خاموش کنید.")}
	}
	dns := time.Since(started)

	started = time.Now()
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, port), 8*time.Second)
	if err != nil {
		return []Check{bad(name, fmt.Sprintf("%s (%s) پاسخ نداد: %v", host, addrs[0], err),
			"فایروال یا فیلترینگ جلوی اتصال را گرفته است؛ با وی‌پی‌ان امتحان کنید.")}
	}
	conn.Close()
	tcp := time.Since(started)

	client := &http.Client{Timeout: 10 * time.Second,
		Transport: &http.Transport{Proxy: http.ProxyFromEnvironment}}
	defer client.CloseIdleConnections()
	started = time.Now()
	resp, err := client.Get(rawURL)
	if err != nil {
		return []Check{warn(name, fmt.Sprintf("اتصال برقرار شد ولی پاسخ نداد: %v", err),
			"معمولاً یعنی فیلترینگ یا وی‌پی‌ان ناپایدار.")}
	}
	resp.Body.Close()
	return []Check{ok(name, fmt.Sprintf("%s — DNS %.0f ms | اتصال %.0f ms | پاسخ %.0f ms (HTTP %d)",
		host, ms(dns), ms(tcp), ms(time.Since(started)), resp.StatusCode))}
}

func ms(d time.Duration) float64 { return float64(d) / float64(time.Millisecond) }

func checkTsetmc() Check {
	hits, _, source, err := FetchTSETMC(nil, 12*time.Second)
	if err != nil {
		return warn("فهرست نمادها (tsetmc)", err.Error(),
			"بدون آن هم کار می‌کند؛ نماد از خود کارگزاری گرفته می‌شود.")
	}
	return ok("فهرست نمادها (tsetmc)", fmt.Sprintf("%d نماد از %s", len(hits), shortHost(source)))
}

func shortHost(rawURL string) string {
	if parsed, err := url.Parse(rawURL); err == nil && parsed.Host != "" {
		return parsed.Host
	}
	return rawURL
}

func checkLearned(cfg Config, status CaptureStatus) Check {
	var missing []string
	if !status.LoggedIn {
		missing = append(missing, "ورود به حساب")
	}
	if strings.TrimSpace(cfg.OrderURL) == "" {
		missing = append(missing, "نشانی ثبت سفارش")
	}
	if strings.TrimSpace(cfg.PayloadTemplate) == "" {
		missing = append(missing, "قالب سفارش")
	}
	if len(missing) == 0 {
		detail := "نشانی سفارش: " + cfg.OrderURL
		if status.TokenExpired {
			return warn("یادگیری تنظیمات", detail+" — توکن منقضی شده است",
				"در پنجرهٔ ایزی‌تریدر دوباره وارد حساب شوید.")
		}
		return ok("یادگیری تنظیمات", detail)
	}
	return bad("یادگیری تنظیمات", "هنوز یاد گرفته نشده: "+strings.Join(missing, "، "),
		"دکمهٔ «باز کردن ایزی‌تریدر» را بزنید، وارد حساب شوید و یک‌بار پنجرهٔ ثبت سفارش را "+
			"باز کنید تا برنامه نشانی و قالب واقعی سفارش را ببیند.")
}

func checkClock(cfg Config) Check {
	clock := SyncClock(cfg.BaseURL, ntpServers, 50*time.Millisecond)
	if clock.Samples == 0 {
		return warn("ساعت", "هیچ منبع زمانی در دسترس نبود",
			"بدون همگام‌سازی، شلیک با ساعت ویندوز انجام می‌شود که می‌تواند ثانیه‌ها خطا داشته باشد.")
	}
	detail := clock.Describe()
	if diff := clock.Now().Sub(time.Now()); diff > 2*time.Second || diff < -2*time.Second {
		return warn("ساعت", detail,
			"ساعت ویندوز بیش از دو ثانیه با ساعت واقعی فرق دارد؛ بهتر است در تنظیمات ویندوز "+
				"همگام‌سازی خودکار زمان را روشن کنید.")
	}
	return ok("ساعت", detail)
}
