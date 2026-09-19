package main

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// EasyTraderURL نشانی نسخهٔ وب ایزی‌تریدر.
const EasyTraderURL = "https://d.easytrader.ir/"

// Browser مرورگر کنترل‌شده‌ای که ایزی‌تریدر در آن باز می‌شود.
//
// از پروفایل جدا استفاده می‌کنیم تا نه به کروم بازِ خود کاربر دست بزنیم و نه
// لازم باشد او چیزی را ببندد. کوکی‌های همین پروفایل می‌مانند، پس ورود فقط
// بار اول لازم است.
type Browser struct {
	Port    int
	Path    string
	DataDir string
	// Reused یعنی به پنجره‌ای که از قبل باز بود وصل شدیم، نه اینکه خودمان
	// مرورگر تازه‌ای باز کرده باشیم.
	Reused bool
	cmd    *exec.Cmd
}

// FindBrowser اولین مرورگر کرومیومی نصب‌شده را پیدا می‌کند.
func FindBrowser() (string, error) {
	var candidates []string

	if runtime.GOOS == "windows" {
		programFiles := os.Getenv("ProgramFiles")
		programFilesX86 := os.Getenv("ProgramFiles(x86)")
		localAppData := os.Getenv("LOCALAPPDATA")
		for _, base := range []string{programFiles, programFilesX86, localAppData} {
			if base == "" {
				continue
			}
			candidates = append(candidates,
				filepath.Join(base, `Google\Chrome\Application\chrome.exe`),
				filepath.Join(base, `Microsoft\Edge\Application\msedge.exe`),
				filepath.Join(base, `BraveSoftware\Brave-Browser\Application\brave.exe`),
			)
		}
	} else {
		candidates = append(candidates,
			"/opt/pw-browsers/chromium",
			"/usr/bin/chromium",
			"/usr/bin/chromium-browser",
			"/usr/bin/google-chrome",
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		)
	}

	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	// شاید در PATH باشد.
	for _, name := range []string{"chrome", "msedge", "chromium", "google-chrome"} {
		if path, err := exec.LookPath(name); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("کروم یا اج پیدا نشد؛ مسیر مرورگر را دستی وارد کنید")
}

// freePort یک پورت آزاد روی لوکال‌هاست می‌گیرد.
func freePort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

// portFile فایلی که شمارهٔ درگاه اشکال‌زدایی پنجرهٔ باز در آن نوشته می‌شود.
func portFile(dataDir string) string {
	return filepath.Join(dataDir, "sarkhati-debug-port")
}

// runningBrowser اگر پنجره‌ای با همین پروفایل هنوز باز باشد، به همان وصل می‌شود.
//
// بدون این، اجرای دوبارهٔ برنامه در حالی که پنجرهٔ قبلی باز مانده بود همیشه
// شکست می‌خورد: کروم با پروفایل تکراری، کار را به پنجرهٔ قبلی می‌سپارد و خودش
// بی‌صدا بسته می‌شود، پس درگاه تازه هیچ‌وقت بالا نمی‌آمد و بعد از بیست ثانیه
// پیام «کانال کنترل پاسخ نداد» می‌گرفتید.
func runningBrowser(dataDir string) (*Browser, bool) {
	data, err := os.ReadFile(portFile(dataDir))
	if err != nil {
		return nil, false
	}
	port, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || port <= 0 {
		return nil, false
	}
	if _, err := listTargets(port); err != nil {
		return nil, false
	}
	return &Browser{Port: port, DataDir: dataDir, Reused: true}, true
}

// LaunchBrowser مرورگر را با درگاه اشکال‌زدایی و پروفایل اختصاصی باز می‌کند.
func LaunchBrowser(browserPath, url, profile string) (*Browser, error) {
	dataDir := BrowserProfileDir(profile)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, fmt.Errorf("پوشهٔ پروفایل مرورگر ساخته نشد (%s): %w — "+
			"برنامه را از پوشه‌ای اجرا کنید که اجازهٔ نوشتن دارد", dataDir, err)
	}
	if browser, ok := runningBrowser(dataDir); ok {
		return browser, nil
	}
	if browserPath == "" {
		found, err := FindBrowser()
		if err != nil {
			return nil, err
		}
		browserPath = found
	}
	if _, err := os.Stat(browserPath); err != nil {
		return nil, fmt.Errorf("مرورگر در مسیر «%s» پیدا نشد؛ مسیر کروم یا اج را "+
			"در بخش پیشرفته وارد کنید", browserPath)
	}
	port, err := freePort()
	if err != nil {
		return nil, err
	}

	args := []string{
		fmt.Sprintf("--remote-debugging-port=%d", port),
		"--user-data-dir=" + dataDir,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-background-timer-throttling",
		"--disable-renderer-backgrounding",
		url,
	}
	if runtime.GOOS != "windows" {
		// در محیط‌های بدون نمایشگر (تست خودکار) مرورگر باید بدون سندباکس اجرا شود.
		args = append([]string{"--no-sandbox"}, args...)
	}
	if os.Getenv("SARKHATI_HEADLESS") != "" {
		// فقط برای تست خودکار؛ کاربر عادی باید پنجره را ببیند تا وارد حساب شود.
		args = append([]string{"--headless=new"}, args...)
	}

	cmd := exec.Command(browserPath, args...)
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("اجرای مرورگر ناموفق بود: %w", err)
	}

	browser := &Browser{Port: port, Path: browserPath, DataDir: dataDir, cmd: cmd}
	// منتظر می‌مانیم تا درگاه اشکال‌زدایی بالا بیاید.
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := listTargets(port); err == nil {
			os.WriteFile(portFile(dataDir), []byte(strconv.Itoa(port)), 0o600)
			return browser, nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	cmd.Process.Kill()
	return nil, fmt.Errorf("مرورگر باز شد ولی کانال کنترل پاسخ نداد — "+
		"اگر پنجره‌ای از همین برنامه باز است ببندید و دوباره امتحان کنید؛ "+
		"در غیر این صورت آنتی‌ویروس یا سیاست سازمانی جلوی درگاه اشکال‌زدایی %d را گرفته است", port)
}

// forgetPort نشانهٔ پنجرهٔ باز را پاک می‌کند.
func forgetPort(dataDir string) {
	os.Remove(portFile(dataDir))
}

// Running می‌گوید مرورگر هنوز زنده است یا نه.
func (b *Browser) Running() bool {
	if b == nil || b.Port == 0 {
		return false
	}
	// پنجره‌ای که خودمان باز نکرده‌ایم (Reused) فرایندی برای بررسی ندارد؛
	// تنها نشانهٔ زنده‌بودنش پاسخ‌دادن کانال کنترل است.
	if b.cmd != nil && b.cmd.ProcessState != nil && b.cmd.ProcessState.Exited() {
		return false
	}
	_, err := listTargets(b.Port)
	return err == nil
}

// Close مرورگر کنترل‌شده را می‌بندد.
func (b *Browser) Close() {
	if b == nil {
		return
	}
	forgetPort(b.DataDir)
	if b.cmd == nil || b.cmd.Process == nil {
		return
	}
	b.cmd.Process.Kill()
	b.cmd.Wait()
}
