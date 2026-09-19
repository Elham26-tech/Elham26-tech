package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// AppVersion نسخهٔ برنامه. در فایل تنظیمات هم نوشته می‌شود تا بشود فهمید
// تنظیماتِ روی دیسک از کدام نسخه مانده است.
const AppVersion = "1.5.0"

var (
	dataDirOnce sync.Once
	dataDirPath string
	dataDirNote string
)

// DataDir پوشه‌ای که برنامه در آن می‌نویسد (تنظیمات، جدول نمادها، پروفایل مرورگر).
//
// اول کنار خود فایل اجرایی — چون برنامه «بدون نصب» است و بهتر است همه‌چیز در
// همان پوشه بماند — ولی فقط اگر آن پوشه واقعاً نوشتنی باشد.
//
// چرا این‌قدر مهم است: وقتی برنامه را از داخل فایل فشرده (ویندوز آن را در یک
// پوشهٔ موقت باز می‌کند)، از Program Files، از یک درایو شبکه یا از پوشه‌ای که
// «دسترسی کنترل‌شدهٔ پوشه»ی ویندوز قفلش کرده اجرا کنند، هیچ فایلی نوشته
// نمی‌شود. تا پیش از این، برنامه بی‌صدا از این خطا می‌گذشت: روی کامپیوتری که
// یک‌بار تنظیمات را ذخیره کرده بود کار می‌کرد و روی کامپیوتر بعدی نه — نه
// تنظیمات می‌ماند، نه پروفایل مرورگر ساخته می‌شد، نه یادگیری انجام می‌شد.
func DataDir() string {
	dataDirOnce.Do(resolveDataDir)
	return dataDirPath
}

// DataDirNote توضیح فارسیِ اینکه چرا این پوشه انتخاب شده است.
func DataDirNote() string {
	dataDirOnce.Do(resolveDataDir)
	return dataDirNote
}

func resolveDataDir() {
	if beside, ok := exeDir(); ok && !temporaryDir(beside) && Writable(beside) {
		dataDirPath = beside
		dataDirNote = "کنار خود فایل اجرایی (حالت قابل حمل)"
		return
	}
	fallback := userDataDir()
	if fallback != "" {
		if err := os.MkdirAll(fallback, 0o700); err == nil && Writable(fallback) {
			dataDirPath = fallback
			dataDirNote = "پوشهٔ کاربر — چون پوشهٔ فایل اجرایی نوشتنی نبود " +
				"(از داخل فایل فشرده یا پوشهٔ محافظت‌شده اجرا شده است)"
			return
		}
	}
	dataDirPath = os.TempDir()
	dataDirNote = "پوشهٔ موقت ویندوز — هیچ پوشهٔ نوشتنی دیگری پیدا نشد؛ " +
		"تنظیمات ممکن است پاک شود"
}

func exeDir() (string, bool) {
	exe, err := os.Executable()
	if err != nil {
		return "", false
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return filepath.Dir(exe), true
}

// temporaryDir می‌گوید این پوشه همان جایی است که ویندوز فایل فشرده را در آن باز
// می‌کند. اجرای مستقیم برنامه از داخل فایل zip دقیقاً همین‌جا می‌افتد و هر چه
// ذخیره شود با بستن پنجره از بین می‌رود.
func temporaryDir(dir string) bool {
	lowered := strings.ToLower(filepath.Clean(dir))
	roots := []string{os.TempDir(), os.Getenv("TEMP"), os.Getenv("TMP"), os.Getenv("TMPDIR")}
	for _, root := range roots {
		if root == "" {
			continue
		}
		if strings.HasPrefix(lowered, strings.ToLower(filepath.Clean(root))) {
			return true
		}
	}
	// مسیرهایی که ویندوز برای باز کردن فایل فشرده می‌سازد.
	for _, mark := range []string{`\temp\`, `/temp/`, `\temporary internet files\`,
		`\inetcache\`, `\windows\system32\`} {
		if strings.Contains(lowered, mark) {
			return true
		}
	}
	return false
}

// Writable با نوشتن یک فایل آزمایشی بررسی می‌کند که پوشه واقعاً نوشتنی است.
//
// فقط نگاه‌کردن به مجوزها کافی نیست: «دسترسی کنترل‌شدهٔ پوشه»ی ویندوز، درایو
// شبکه و پوشهٔ فقط‌خواندنی، همه در ظاهر سالم‌اند و در عمل خطا می‌دهند.
func Writable(dir string) bool {
	if dir == "" {
		return false
	}
	probe, err := os.CreateTemp(dir, ".sarkhati-*")
	if err != nil {
		return false
	}
	name := probe.Name()
	probe.Close()
	os.Remove(name)
	return true
}

// userDataDir پوشهٔ مخصوص برنامه در پروفایل کاربر.
func userDataDir() string {
	if runtime.GOOS == "windows" {
		for _, key := range []string{"LOCALAPPDATA", "APPDATA", "USERPROFILE"} {
			if base := os.Getenv(key); base != "" {
				return filepath.Join(base, "Sarkhati")
			}
		}
		return ""
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".sarkhati")
}

// DefaultConfigPath مسیر فایل تنظیمات.
func DefaultConfigPath() string {
	return filepath.Join(DataDir(), "sarkhati-config.json")
}

// BrowserProfileDir پوشهٔ پروفایل مرورگرِ یک حساب.
//
// هر حساب پروفایل خودش را دارد، وگرنه ورود به حساب دوم، نشست حساب اول را
// بیرون می‌اندازد.
func BrowserProfileDir(profile string) string {
	if profile == "" {
		profile = "main"
	}
	return filepath.Join(DataDir(), "sarkhati-browser", safeName(profile))
}

// safeName نام پوشهٔ امن از روی شناسهٔ حساب.
func safeName(name string) string {
	var out strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			out.WriteRune(r)
		default:
			out.WriteRune('-')
		}
	}
	if out.Len() == 0 {
		return "main"
	}
	return out.String()
}

// MigrateLegacyConfig تنظیماتِ کنار فایل اجرایی را به پوشهٔ کاری منتقل می‌کند.
//
// وقتی برنامه از پوشهٔ نوشتنی به پوشهٔ کاربر عقب می‌نشیند (چون پوشهٔ فایل
// اجرایی نوشتنی نیست)، تنظیماتِ قبلی نباید گم شود؛ وگرنه کاربر فکر می‌کند
// نسخهٔ تازه همه‌چیز را از یاد برده است.
func MigrateLegacyConfig() (string, bool) {
	beside, ok := exeDir()
	if !ok {
		return "", false
	}
	target := DataDir()
	if filepath.Clean(beside) == filepath.Clean(target) {
		return "", false
	}
	moved := false
	for _, name := range []string{"sarkhati-config.json", "sarkhati-config-symbols.json"} {
		source := filepath.Join(beside, name)
		destination := filepath.Join(target, name)
		if _, err := os.Stat(destination); err == nil {
			continue // نسخهٔ تازه‌تر همان‌جاست
		}
		data, err := os.ReadFile(source)
		if err != nil {
			continue
		}
		if os.WriteFile(destination, data, 0o600) == nil && name == "sarkhati-config.json" {
			moved = true
		}
	}
	return target, moved
}
