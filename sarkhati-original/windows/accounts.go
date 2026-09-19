package main

import (
	"fmt"
	neturl "net/url"
	"strings"
	"time"
)

// چند حساب کارگزاری، هم‌زمان.
//
// یک حساب در اینجا یعنی عکسِ فوری از همان چیزهایی که برای حساب اصلی هم یاد
// گرفته می‌شود: نشانی ثبت سفارش، قالب بدنه، هدرها و توکن ورود. هر حساب
// پروفایل مرورگر خودش را دارد، وگرنه ورود به حساب دوم نشست حساب اول را بیرون
// می‌اندازد و عملاً هیچ‌وقت دو حساب هم‌زمان آماده نمی‌شوند.

// Account یک حساب کارگزاری دیگر که سفارش هم‌زمان برایش فرستاده می‌شود.
type Account struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
	Profile string `json:"profile"`
	// Quantity حجم اختصاصی این حساب؛ صفر یعنی همان حجم سفارش اصلی.
	Quantity int64 `json:"quantity,omitempty"`

	BaseURL    string            `json:"base_url,omitempty"`
	OrderURL   string            `json:"order_url,omitempty"`
	OrderPath  string            `json:"order_path,omitempty"`
	Token      string            `json:"token,omitempty"`
	Headers    map[string]string `json:"order_headers,omitempty"`
	Template   string            `json:"payload_template,omitempty"`
	DateSample string            `json:"order_date_sample,omitempty"`
	Commission float64           `json:"order_commission,omitempty"`
	SideBuy    string            `json:"side_buy,omitempty"`
	SideSell   string            `json:"side_sell,omitempty"`
	SavedAt    time.Time         `json:"saved_at,omitempty"`
}

// AccountView وضعیت حساب برای رابط کاربری.
type AccountView struct {
	Account
	Ready      bool   `json:"ready"`
	TokenTTL   string `json:"token_ttl"`
	ExpiresAt  string `json:"expires_at"`
	Expired    bool   `json:"expired"`
	Missing    string `json:"missing"`
	OrderHost  string `json:"order_host"`
	SavedAtFa  string `json:"saved_at_fa"`
	TokenShort string `json:"token_short"`
}

// Ready می‌گوید این حساب همه‌چیزِ لازم برای ارسال را دارد.
func (a Account) Ready() bool {
	return a.Token != "" && strings.TrimSpace(a.OrderURL) != "" && strings.TrimSpace(a.Template) != ""
}

// Missing چیزی که هنوز کم دارد، به زبان آدمیزاد.
func (a Account) Missing() string {
	var missing []string
	if a.Token == "" {
		missing = append(missing, "ورود به حساب")
	}
	if strings.TrimSpace(a.OrderURL) == "" {
		missing = append(missing, "نشانی ثبت سفارش")
	}
	if strings.TrimSpace(a.Template) == "" {
		missing = append(missing, "قالب سفارش")
	}
	return strings.Join(missing, "، ")
}

// View وضعیت خواندنی این حساب.
func (a Account) View() AccountView {
	view := AccountView{Account: a, Ready: a.Ready(), Missing: a.Missing()}
	// توکن خودش هرگز به رابط کاربری نمی‌رود؛ فقط نشانه و زمان انقضا.
	view.Token = ""
	if a.Token != "" {
		view.TokenShort = previewToken(a.Token)
		if expiry, ok := jwtExpiry(a.Token); ok {
			view.ExpiresAt = expiry.In(Tehran()).Format("15:04:05")
			remaining := time.Until(expiry)
			view.Expired = remaining <= 0
			view.TokenTTL = humanDuration(remaining)
		}
	}
	if parsed := hostOf(a.OrderURL); parsed != "" {
		view.OrderHost = parsed
	}
	if !a.SavedAt.IsZero() {
		view.SavedAtFa = a.SavedAt.In(Tehran()).Format("2006-01-02 15:04")
	}
	return view
}

// Apply پیکربندی ارسال این حساب را می‌سازد: همان نماد، قیمت، سمت و زمان‌بندی،
// ولی با نشانی و توکن و قالبِ خودِ این حساب.
func (a Account) Apply(cfg Config) Config {
	out := cfg
	out.Token = a.Token
	if a.BaseURL != "" {
		out.BaseURL = a.BaseURL
	}
	if a.OrderURL != "" {
		out.OrderURL = a.OrderURL
		out.OrderPath = a.OrderPath
	}
	if a.Template != "" {
		out.PayloadTemplate = a.Template
	}
	if a.DateSample != "" {
		out.OrderDateSample = a.DateSample
	}
	if a.Commission > 0 {
		out.OrderCommission = a.Commission
	}
	if a.SideBuy != "" || a.SideSell != "" {
		out.SideBuy, out.SideSell = a.SideBuy, a.SideSell
	}
	if len(a.Headers) > 0 {
		out.OrderHeaders = a.Headers
	}
	if a.Quantity > 0 {
		out.Quantity = a.Quantity
	}
	return out
}

// Snapshot آنچه همین حالا یاد گرفته شده را داخل حساب می‌ریزد.
func (a *Account) Snapshot(cfg Config) error {
	if strings.TrimSpace(cfg.Token) == "" {
		return fmt.Errorf("هنوز وارد حسابی نشده‌اید؛ در پنجرهٔ ایزی‌تریدر وارد شوید و دوباره بزنید")
	}
	if strings.TrimSpace(cfg.OrderURL) == "" || strings.TrimSpace(cfg.PayloadTemplate) == "" {
		return fmt.Errorf("نشانی یا قالب سفارش هنوز یاد گرفته نشده؛ یک‌بار پنجرهٔ ثبت سفارش را باز کنید")
	}
	a.Token = cfg.Token
	a.BaseURL = cfg.BaseURL
	a.OrderURL = cfg.OrderURL
	a.OrderPath = cfg.OrderPath
	a.Template = cfg.PayloadTemplate
	a.DateSample = cfg.OrderDateSample
	a.Commission = cfg.OrderCommission
	a.SideBuy, a.SideSell = cfg.SideBuy, cfg.SideSell
	a.Headers = cfg.OrderHeaders
	a.SavedAt = time.Now()
	return nil
}

// ActiveAccounts حساب‌هایی که باید هم‌زمان با حساب اصلی سفارش بگیرند.
//
// حسابی که توکنش همان توکن حساب باز در مرورگر است کنار گذاشته می‌شود: وگرنه
// یک حساب دو سفارش می‌گرفت.
func ActiveAccounts(cfg Config) []Account {
	var active []Account
	for _, account := range cfg.Accounts {
		if !account.Enabled || !account.Ready() {
			continue
		}
		if account.Token == cfg.Token {
			continue
		}
		active = append(active, account)
	}
	return active
}

// newAccountID شناسهٔ کوتاه و یکتا برای حساب تازه.
func newAccountID(existing []Account) string {
	for i := 2; ; i++ {
		id := fmt.Sprintf("account-%d", i)
		taken := false
		for _, account := range existing {
			if account.ID == id {
				taken = true
				break
			}
		}
		if !taken {
			return id
		}
	}
}

// hostOf میزبان یک نشانی، برای نمایش کوتاه.
func hostOf(rawURL string) string {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return ""
	}
	if parsed, err := neturl.Parse(trimmed); err == nil && parsed.Host != "" {
		return parsed.Host
	}
	return trimmed
}
