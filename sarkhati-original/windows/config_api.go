package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
)

// درگاه‌های عیب‌یابی و مدیریت فایل تنظیمات.

func (s *Server) handleSelfTest(w http.ResponseWriter, r *http.Request) {
	cfg := s.current()
	checks := SelfTest(cfg, s.capturer.Status(), s.configPath)
	worst := CheckOK
	for _, check := range checks {
		if check.Level == CheckBad {
			worst = CheckBad
			break
		}
		if check.Level == CheckWarn {
			worst = CheckWarn
		}
	}
	report := selfTestReport(checks)
	s.engine.logf("عیب‌یابی اجرا شد — نتیجه: %s", map[string]string{
		CheckOK: "همه‌چیز سالم", CheckWarn: "با هشدار", CheckBad: "ایراد جدی"}[worst])
	writeJSON(w, map[string]interface{}{"ok": worst != CheckBad, "worst": worst,
		"checks": checks, "report": report})
}

// selfTestReport گزارش متنی، برای کپی‌کردن و فرستادن.
func selfTestReport(checks []Check) string {
	var out strings.Builder
	fmt.Fprintf(&out, "گزارش عیب‌یابی سرخطی‌زن %s\n\n", AppVersion)
	marks := map[string]string{CheckOK: "[سالم]", CheckWarn: "[هشدار]", CheckBad: "[ایراد]"}
	for _, check := range checks {
		fmt.Fprintf(&out, "%s %s: %s\n", marks[check.Level], check.Name, check.Detail)
		if check.Fix != "" {
			fmt.Fprintf(&out, "        راه‌حل: %s\n", check.Fix)
		}
	}
	return out.String()
}

// handleConfigDefaults عددهای تنظیمی را به پیش‌فرض نسخهٔ جدید برمی‌گرداند.
func (s *Server) handleConfigDefaults(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	s.config = s.config.WithFreshDefaults()
	s.configVersion = AppVersion
	s.mu.Unlock()
	if err := s.saveConfig(); err != nil {
		fail(w, err)
		return
	}
	s.engine.logf("تنظیمات به پیش‌فرض نسخهٔ %s برگشت (یادگیری و حساب‌ها دست‌نخورده)", AppVersion)
	writeJSON(w, map[string]interface{}{"ok": true, "config": s.current()})
}

// handleConfigReset تنظیمات را پاک می‌کند.
//
// دو دامنه: «learned» فقط آنچه از کارگزاری یاد گرفته شده (برای سوئیچ به حساب
// یا کارگزاری دیگر)، و «all» کل فایل تنظیمات و حساب‌ها.
func (s *Server) handleConfigReset(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Scope string `json:"scope"`
	}
	json.NewDecoder(r.Body).Decode(&payload)

	switch strings.TrimSpace(payload.Scope) {
	case "all":
		s.capturer.Stop()
		s.capturer.Forget()
		s.mu.Lock()
		s.config = DefaultConfig()
		s.configVersion = AppVersion
		s.mu.Unlock()
		os.Remove(s.configPath)
		if err := s.saveConfig(); err != nil {
			fail(w, err)
			return
		}
		s.engine.logf("همهٔ تنظیمات و حساب‌ها پاک شد")
	case "learned":
		s.capturer.Forget()
		s.mu.Lock()
		s.config = s.config.WithoutLearned()
		s.mu.Unlock()
		if err := s.saveConfig(); err != nil {
			fail(w, err)
			return
		}
		s.engine.logf("یادگرفته‌های کارگزاری پاک شد؛ یک‌بار دیگر وارد حساب شوید")
	default:
		fail(w, fmt.Errorf("دامنهٔ پاک‌کردن مشخص نیست"))
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "config": s.current(), "accounts": s.accountViews()})
}

// handleConfigExport فایل تنظیمات را برای بردن به کامپیوتر دیگر می‌دهد.
func (s *Server) handleConfigExport(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	cfg := s.config
	s.mu.Unlock()
	cfg.Version = AppVersion
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="sarkhati-config.json"`)
	w.Write(data)
}

// handleConfigImport تنظیماتِ کامپیوتر دیگر را می‌گیرد.
func (s *Server) handleConfigImport(w http.ResponseWriter, r *http.Request) {
	var incoming Config
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&incoming); err != nil {
		fail(w, fmt.Errorf("فایل تنظیمات خوانده نشد: %v", err))
		return
	}
	if strings.TrimSpace(incoming.Mode) == "" && strings.TrimSpace(incoming.OrderURL) == "" {
		fail(w, fmt.Errorf("این فایل، فایل تنظیمات سرخطی‌زن نیست"))
		return
	}
	// نماد را نمی‌بریم: هر اجرا باید آگاهانه انتخاب شود.
	incoming.Symbol, incoming.SymbolName, incoming.ISIN = "", "", ""
	s.mu.Lock()
	s.config = incoming
	s.configVersion = strings.TrimSpace(incoming.Version)
	s.mu.Unlock()
	if err := s.saveConfig(); err != nil {
		fail(w, err)
		return
	}
	cfg := s.current()
	s.capturer.Seed(cfg.SearchEndpoint, cfg.InstrumentEndpoint,
		cfg.OrderURL, cfg.OrderPath, cfg.PayloadTemplate, cfg.BaseURL)
	s.engine.logf("تنظیمات از فایل خوانده شد؛ %d حساب هم آمد", len(incoming.Accounts))
	writeJSON(w, map[string]interface{}{"ok": true, "config": cfg, "accounts": s.accountViews()})
}
