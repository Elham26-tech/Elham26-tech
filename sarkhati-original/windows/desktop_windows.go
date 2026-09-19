//go:build windows

package main

import (
	"fmt"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var (
	user32                  = syscall.NewLazyDLL("user32.dll")
	procSetCursorPos        = user32.NewProc("SetCursorPos")
	procMouseEvent          = user32.NewProc("mouse_event")
	procEnumWindows         = user32.NewProc("EnumWindows")
	procGetWindowTextW      = user32.NewProc("GetWindowTextW")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	procShowWindow          = user32.NewProc("ShowWindow")
	procIsWindowVisible     = user32.NewProc("IsWindowVisible")
)

const (
	mouseEventLeftDown = 0x0002
	mouseEventLeftUp   = 0x0004
	swRestore          = 9
)

// DesktopSender پنجرهٔ ایزی‌تریدر دسکتاپ را می‌راند.
//
// فرم سفارش را خودتان از قبل پر می‌کنید؛ این فقط سرِ ساعت روی دکمهٔ «ارسال»
// کلیک می‌کند — همان کاری که دست آدم می‌کند، با دقت میلی‌ثانیه.
type DesktopSender struct{ cfg Config }

func NewDesktopSender(cfg Config) *DesktopSender { return &DesktopSender{cfg: cfg} }

func (d *DesktopSender) Prepare(price int64) error {
	if d.cfg.ClickX <= 0 || d.cfg.ClickY <= 0 {
		return fmt.Errorf("مختصات دکمهٔ ارسال تنظیم نشده است")
	}
	if err := focusWindow(d.cfg.WindowTitle); err != nil {
		return err
	}
	time.Sleep(150 * time.Millisecond) // فرصت بده پنجره واقعاً جلو بیاید
	return setCursor(d.cfg.ClickX, d.cfg.ClickY)
}

func (d *DesktopSender) KeepAlive() {
	// نشانگر ممکن است جابه‌جا شده باشد؛ دوباره سرِ جایش می‌گذاریم.
	setCursor(d.cfg.ClickX, d.cfg.ClickY)
}

func (d *DesktopSender) Send(attempt int) Result {
	if err := setCursor(d.cfg.ClickX, d.cfg.ClickY); err != nil {
		return Result{Accepted: false, Detail: err.Error()}
	}
	procMouseEvent.Call(mouseEventLeftDown, 0, 0, 0, 0)
	procMouseEvent.Call(mouseEventLeftUp, 0, 0, 0, 0)
	// از روی رابط گرافیکی نمی‌شود فهمید سفارش پذیرفته شد یا نه؛ پذیرش را
	// «انجام‌شده» گزارش می‌کنیم تا تلاش دوم سفارش تکراری نسازد.
	return Result{Accepted: true, Detail: fmt.Sprintf(
		"کلیک روی (%d, %d) انجام شد — تأیید را در ایزی‌تریدر ببینید", d.cfg.ClickX, d.cfg.ClickY)}
}

func (d *DesktopSender) Close() {}

func setCursor(x, y int) error {
	ret, _, err := procSetCursorPos.Call(uintptr(x), uintptr(y))
	if ret == 0 {
		return fmt.Errorf("جابه‌جایی نشانگر ناموفق: %v", err)
	}
	return nil
}

// focusWindow پنجره‌ای که عنوانش شامل title است را جلو می‌آورد.
func focusWindow(title string) error {
	if strings.TrimSpace(title) == "" {
		return nil // کاربر عنوانی نداده؛ فرض می‌کنیم پنجره خودش جلوست
	}
	needle := strings.ToLower(title)
	var found uintptr

	callback := syscall.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
		if visible, _, _ := procIsWindowVisible.Call(hwnd); visible == 0 {
			return 1
		}
		buf := make([]uint16, 512)
		n, _, _ := procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
		if n == 0 {
			return 1
		}
		if strings.Contains(strings.ToLower(syscall.UTF16ToString(buf[:n])), needle) {
			found = hwnd
			return 0 // پیدا شد؛ شمارش را تمام کن
		}
		return 1
	})
	procEnumWindows.Call(callback, 0)

	if found == 0 {
		return fmt.Errorf("پنجره‌ای با عنوان «%s» پیدا نشد", title)
	}
	procShowWindow.Call(found, swRestore)
	procSetForegroundWindow.Call(found)
	return nil
}
