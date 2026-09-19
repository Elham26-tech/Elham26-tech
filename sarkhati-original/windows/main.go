// سرخطی‌زن بورس تهران — نسخهٔ ویندوز، بدون نصب.
//
// یک فایل اجرایی مستقل: اجرا که شد، یک سرور کوچک روی 127.0.0.1 بالا می‌آورد و
// رابط کاربری را در مرورگر پیش‌فرض باز می‌کند. هیچ نصبی، هیچ وابستگی‌ای و هیچ
// دست‌کاری رجیستری‌ای در کار نیست؛ تنظیمات کنار خود فایل ذخیره می‌شود.
package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"
	"time"
)

func main() {
	port := flag.Int("port", 0, "پورت سرور محلی (۰ = انتخاب خودکار)")
	noBrowser := flag.Bool("no-browser", false, "مرورگر را خودکار باز نکن")
	configPath := flag.String("config", DefaultConfigPath(), "مسیر فایل تنظیمات")
	flag.Parse()

	server, err := NewServer(*configPath)
	if err != nil {
		fmt.Println("خطا در راه‌اندازی:", err)
		waitForEnter()
		os.Exit(1)
	}

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		fmt.Println("پورت محلی باز نشد:", err)
		waitForEnter()
		os.Exit(1)
	}
	addr := listener.Addr().String()
	url := server.URL(addr)

	fmt.Println("سرخطی‌زن بورس تهران — نسخهٔ", AppVersion)
	fmt.Println("رابط کاربری:", url)
	fmt.Println("تنظیمات:", *configPath)
	fmt.Println("پوشهٔ کاری:", DataDirNote())
	if !Writable(DataDir()) {
		fmt.Println("هشدار: این پوشه نوشتنی نیست؛ تنظیمات ذخیره نمی‌شود.")
		fmt.Println("برنامه را از داخل فایل فشرده اجرا نکنید: اول Extract کنید و بعد اجرا.")
	}
	fmt.Println("برای بستن، این پنجره را ببندید یا Ctrl+C بزنید.")

	httpServer := &http.Server{Handler: server.Handler()}
	go func() {
		if err := httpServer.Serve(listener); err != nil && err != http.ErrServerClosed {
			fmt.Println("سرور متوقف شد:", err)
		}
	}()

	if !*noBrowser {
		if err := openBrowser(url); err != nil {
			fmt.Println("مرورگر خودکار باز نشد؛ نشانی بالا را دستی باز کنید.")
		}
	}

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	select {
	case <-signals:
	case <-server.shutdownCh:
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	httpServer.Shutdown(ctx)
	fmt.Println("خداحافظ.")
}

// openBrowser صفحه را در مرورگر پیش‌فرض باز می‌کند.
func openBrowser(url string) error {
	switch runtime.GOOS {
	case "windows":
		// rundll32 مطمئن‌ترین راه است: نه به cmd وابسته است نه به کوتیشن‌ها.
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}

// waitForEnter تا کاربر کلید بزند صبر می‌کند، وگرنه پنجرهٔ خطا فوری بسته می‌شود.
func waitForEnter() {
	fmt.Println("برای بستن، Enter بزنید…")
	fmt.Scanln()
}
