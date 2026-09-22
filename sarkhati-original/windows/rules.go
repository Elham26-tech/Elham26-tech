package main

import (
	"fmt"
	"strings"
)

// sideCodesFrom کد خرید و فروش را از روی سمتِ سفارشِ یادگرفته‌شده می‌سازد.
//
// فقط یکی از دو کد را دیده‌ایم؛ دیگری از روی الگوی رایج حدس زده می‌شود و در
// تنظیمات پیشرفته قابل اصلاح است.
func sideCodesFrom(sample string, capturedIsSell bool) (buy, sell string) {
	other := map[string]string{"0": "1", "1": "0", "2": "1", "buy": "sell", "sell": "buy",
		"Buy": "Sell", "Sell": "Buy", "BUY": "SELL", "SELL": "BUY"}
	counterpart, ok := other[sample]
	if !ok {
		counterpart = sample
	}
	// اگر سمتِ دیده‌شده «۱» باشد، هم می‌تواند خرید در الگوی ۱/۲ باشد و هم
	// فروش در الگوی ۰/۱؛ پیش‌فرض را خرید می‌گیریم چون سرخطی خرید است.
	if sample == "1" && !capturedIsSell {
		counterpart = "2"
	}
	if capturedIsSell {
		return counterpart, sample
	}
	return sample, counterpart
}

// حالت‌های شلیک.
const (
	FireUntilStop = "until_stop" // از لحظهٔ هدف تا وقتی کاربر متوقف کند
	FireCount     = "count"      // تعداد مشخص
)

// MaxAttempts سقف مطلق تعداد تلاش، برای جلوگیری از حلقهٔ بی‌پایان.
//
// با فاصلهٔ پنج میلی‌ثانیه، سه دقیقه شلیک پیوسته حدود ۳۶ هزار ارسال است؛ سقف
// باید بالاتر از آن باشد وگرنه شلیک وسط کار و بی‌صدا می‌ایستد.
const MaxAttempts = 100000

// MinGapMs کمترین فاصلهٔ مجاز بین دو ارسال.
//
// هر تلاش یک سفارش واقعی است؛ فاصلهٔ خیلی کم یعنی کوبیدن به سرور کارگزار.
// ولی سرخطی یعنی همین: پنج میلی‌ثانیه یعنی تا دویست ارسال در ثانیه.
const MinGapMs = 5

// MaxConnections سقف اتصال‌های موازی به کارگزار.
//
// نرخ ارسال برابر است با «تعداد اتصال ÷ زمان پاسخ»؛ با پاسخ ۶۰ میلی‌ثانیه‌ای،
// شانزده اتصال یعنی حدود ۲۶۰ ارسال در ثانیه. بیشتر از این نه سودی دارد و نه
// کارگزار تحمل می‌کند.
const MaxConnections = 16

// AutoConnections یعنی تعداد اتصال از روی زمان پاسخ و فاصلهٔ ارسال حساب شود.
const AutoConnections = 0

// حالت‌های قیمت‌گذاری.
const (
	PriceUpperBand = "upper_band"
	PriceLowerBand = "lower_band"
	PriceLimit     = "limit"
)

// Config تنظیمات برنامه؛ کنار خود فایل اجرایی در JSON ذخیره می‌شود.
//
// سقف و کف قیمت و محدودیت حجم اینجا نیست: آن‌ها را از خود کارگزاری
// می‌گیریم، چون مرجع واقعی همان است نه فرمولی که ما حساب کنیم.
type Config struct {
	// سفارش
	Symbol     string `json:"symbol"`
	SymbolName string `json:"symbol_name"`
	ISIN       string `json:"isin"`
	Side       string `json:"side"` // buy | sell
	Quantity   int64  `json:"quantity"`
	PriceMode  string `json:"price_mode"`
	LimitPrice int64  `json:"limit_price"`

	// زمان‌بندی — ساعت، دقیقه، ثانیه و میلی‌ثانیهٔ هدف
	TargetHour   int `json:"target_hour"`
	TargetMinute int `json:"target_minute"`
	TargetSecond int `json:"target_second"`
	TargetMillis int `json:"target_millis"`

	// ClickAgoMs: چند میلی‌ثانیه پیش دکمهٔ «مسلح کردن» زده شده است.
	//
	// بین فشردن دکمه و رسیدن درخواست، پنجرهٔ تأیید و بررسی سفارش چند ثانیه
	// وقت می‌گیرد. لحظهٔ هدف باید از روی همان لحظهٔ فشردن دکمه حساب شود،
	// وگرنه هدفِ چند ثانیه‌ای «گذشته» به حساب می‌آید. در فایل تنظیمات
	// ذخیره نمی‌شود.
	ClickAgoMs int64 `json:"click_ago_ms,omitempty"`

	// FireMode: تا وقتی متوقف کنیم، یا تعداد مشخص.
	FireMode     string `json:"fire_mode"`
	Retries      int    `json:"retries"`        // تعداد تلاش در حالت «تعداد مشخص»
	RetryGapMs   int    `json:"retry_gap_ms"`   // فاصلهٔ بین ارسال‌ها
	MaxDurationS int    `json:"max_duration_s"` // سقف مدت شلیک پیوسته
	LeadMs       int    `json:"lead_ms"`        // منفی = خودکار (نصف RTT)

	// PreArmSeconds: چند ثانیه *زودتر* از ساعت هدف شلیک شروع شود.
	//
	// کارگزاری‌ها همیشه دقیقاً سر ساعت باز نمی‌کنند و گاهی تا یک دقیقه
	// زودتر بازند. اگر دقیقاً روی ساعت هدف شلیک کنیم، آن پنجره از دست
	// می‌رود. با این مقدار، تلاش‌ها از قبل در جریان‌اند و اولین سفارشی که
	// کارگزاری بپذیرد کار را تمام می‌کند.
	PreArmSeconds int `json:"pre_arm_seconds"`

	// کارگزار — همه از ایزی‌تریدر یاد گرفته می‌شود
	Mode            string `json:"mode"` // api | desktop
	BaseURL         string `json:"base_url"`
	OrderPath       string `json:"order_path"`
	OrderURL        string `json:"order_url"` // نشانی کامل همان درخواست واقعی
	PayloadTemplate string `json:"payload_template"`
	Token           string `json:"-"` // هرگز در فایل ذخیره نمی‌شود
	SuccessMarker   string `json:"success_marker"`
	// Connections تعداد اتصال موازی به کارگزار؛ صفر یعنی خودکار.
	Connections int    `json:"connections"`
	BrowserPath string `json:"browser_path"`
	PortalURL   string `json:"portal_url"`

	// فهرست نمادها از TSETMC؛ مستقل از ورود به کارگزاری و هر بار تازه.
	TsetmcEnabled bool     `json:"tsetmc_enabled"`
	TsetmcURLs    []string `json:"tsetmc_urls,omitempty"`

	// آنچه از ایزی‌تریدر یاد گرفته شده؛ ذخیره می‌شود تا دفعهٔ بعد فقط ورود لازم باشد.
	OrderHeaders    map[string]string `json:"order_headers,omitempty"`
	OrderDateSample string            `json:"order_date_sample,omitempty"`
	OrderCommission float64           `json:"order_commission,omitempty"`

	// کد سمت، از روی همان سفارش واقعی. کارگزاری‌ها یکسان نیستند: مفید برای
	// خرید 0 می‌فرستد، بعضی دیگر 1.
	SideBuy            string    `json:"side_buy,omitempty"`
	SideSell           string    `json:"side_sell,omitempty"`
	SideCapturedIsSell bool      `json:"side_captured_is_sell,omitempty"`
	SearchEndpoint     *Endpoint `json:"search_endpoint,omitempty"`
	InstrumentEndpoint *Endpoint `json:"instrument_endpoint,omitempty"`

	// Accounts حساب‌های کارگزاری دیگر که هم‌زمان سفارش می‌گیرند.
	Accounts []Account `json:"accounts,omitempty"`

	// Version نسخهٔ برنامه‌ای که این فایل تنظیمات را نوشته است.
	Version string `json:"version,omitempty"`

	// حالت دسکتاپ
	WindowTitle string `json:"window_title"`
	ClickX      int    `json:"click_x"`
	ClickY      int    `json:"click_y"`
}

func DefaultConfig() Config {
	return Config{
		Side:          "buy",
		PriceMode:     PriceUpperBand,
		TargetHour:    8,
		TargetMinute:  30,
		FireMode:      FireUntilStop,
		Retries:       50,
		RetryGapMs:    10,
		MaxDurationS:  180,
		LeadMs:        -1,
		PreArmSeconds: 60,
		Mode:          "api",
		SuccessMarker: "",
		Connections:   AutoConnections,
		WindowTitle:   "EasyTrader",
		PortalURL:     EasyTraderURL,
		TsetmcEnabled: true,
	}
}

// WithFreshDefaults تنظیمات تنظیم‌کردنی را به پیش‌فرض نسخهٔ جدید برمی‌گرداند.
//
// هرچه یاد گرفته شده (نشانی سفارش، قالب، هدرها)، حساب‌ها و انتخاب‌های خود
// کاربر (نماد، حجم، سمت، ساعت هدف) دست‌نخورده می‌ماند؛ فقط عددهای تنظیمی —
// فاصلهٔ ارسال، اتصال موازی، پیش‌فرست، سقف مدت — به پیش‌فرض تازه برمی‌گردند.
// بدون این، بهبودهای نسخهٔ جدید هیچ‌وقت به کسی که فایل تنظیمات قدیمی دارد
// نمی‌رسید.
func (c Config) WithFreshDefaults() Config {
	fresh := DefaultConfig()

	fresh.Symbol, fresh.SymbolName, fresh.ISIN = c.Symbol, c.SymbolName, c.ISIN
	fresh.Side, fresh.Quantity = c.Side, c.Quantity
	fresh.TargetHour, fresh.TargetMinute = c.TargetHour, c.TargetMinute
	fresh.TargetSecond, fresh.TargetMillis = c.TargetSecond, c.TargetMillis
	fresh.PreArmSeconds = c.PreArmSeconds

	fresh.Mode, fresh.BaseURL = c.Mode, c.BaseURL
	fresh.OrderPath, fresh.OrderURL = c.OrderPath, c.OrderURL
	fresh.PayloadTemplate, fresh.Token = c.PayloadTemplate, c.Token
	fresh.OrderHeaders, fresh.OrderDateSample = c.OrderHeaders, c.OrderDateSample
	fresh.OrderCommission = c.OrderCommission
	fresh.SideBuy, fresh.SideSell = c.SideBuy, c.SideSell
	fresh.SideCapturedIsSell = c.SideCapturedIsSell
	fresh.SearchEndpoint, fresh.InstrumentEndpoint = c.SearchEndpoint, c.InstrumentEndpoint
	fresh.BrowserPath, fresh.PortalURL = c.BrowserPath, c.PortalURL
	fresh.TsetmcEnabled, fresh.TsetmcURLs = c.TsetmcEnabled, c.TsetmcURLs
	fresh.Accounts = c.Accounts
	fresh.WindowTitle, fresh.ClickX, fresh.ClickY = c.WindowTitle, c.ClickX, c.ClickY
	fresh.Version = AppVersion
	return fresh
}

// WithoutLearned هرچه از کارگزاری یاد گرفته شده را پاک می‌کند.
//
// وقتی به حساب یا کارگزاری دیگری سوئیچ می‌کنید لازم است: نشانی و قالبِ
// یادگرفته‌شدهٔ قبلی روی حساب تازه، سفارش را به جای اشتباه می‌فرستد.
func (c Config) WithoutLearned() Config {
	out := c
	out.BaseURL, out.OrderPath, out.OrderURL = "", "", ""
	out.PayloadTemplate, out.Token = "", ""
	out.OrderHeaders, out.OrderDateSample, out.OrderCommission = nil, "", 0
	out.SideBuy, out.SideSell, out.SideCapturedIsSell = "", "", false
	out.SearchEndpoint, out.InstrumentEndpoint = nil, nil
	out.Symbol, out.SymbolName, out.ISIN = "", "", ""
	return out
}

// TargetTimeText نمایش ساعت هدف.
func (c Config) TargetTimeText() string {
	return fmt.Sprintf("%02d:%02d:%02d.%03d",
		c.TargetHour, c.TargetMinute, c.TargetSecond, c.TargetMillis)
}

// ResolvePrice قیمت نهایی را می‌دهد؛ سقف و کف از کارگزاری می‌آید.
func (c Config) ResolvePrice(limits Limits) (int64, error) {
	switch c.PriceMode {
	case PriceUpperBand:
		if limits.UpperPrice <= 0 {
			return 0, fmt.Errorf("سقف مجاز از کارگزاری گرفته نشده؛ نماد را انتخاب کنید")
		}
		return int64(limits.UpperPrice), nil
	case PriceLowerBand:
		if limits.LowerPrice <= 0 {
			return 0, fmt.Errorf("کف مجاز از کارگزاری گرفته نشده؛ نماد را انتخاب کنید")
		}
		return int64(limits.LowerPrice), nil
	default:
		if c.LimitPrice <= 0 {
			return 0, fmt.Errorf("در حالت قیمت دستی، قیمت را وارد کنید")
		}
		return c.LimitPrice, nil
	}
}

// Validate سفارش را در برابر محدودیت‌های خودِ کارگزاری می‌سنجد.
func (c Config) Validate(limits Limits) []string {
	var problems []string

	if strings.TrimSpace(c.ISIN) == "" {
		problems = append(problems, "نماد انتخاب نشده است")
	}
	if c.Side != "buy" && c.Side != "sell" {
		problems = append(problems, "سمت سفارش باید خرید یا فروش باشد")
	}
	if c.Quantity <= 0 {
		problems = append(problems, "حجم سفارش باید مثبت باشد")
	}
	if limits.MaxQuantity > 0 && float64(c.Quantity) > limits.MaxQuantity {
		problems = append(problems, fmt.Sprintf("حجم %s از سقف کارگزاری (%s) بیشتر است",
			comma(c.Quantity), comma(int64(limits.MaxQuantity))))
	}
	if limits.MinQuantity > 0 && float64(c.Quantity) < limits.MinQuantity {
		problems = append(problems, fmt.Sprintf("حجم %s از کف کارگزاری (%s) کمتر است",
			comma(c.Quantity), comma(int64(limits.MinQuantity))))
	}

	if c.FireMode == FireCount && (c.Retries < 1 || c.Retries > MaxAttempts) {
		problems = append(problems, fmt.Sprintf("تعداد ارسال باید بین ۱ تا %d باشد", MaxAttempts))
	}
	if c.RetryGapMs < MinGapMs {
		problems = append(problems, fmt.Sprintf("فاصلهٔ بین ارسال‌ها کمتر از %d میلی‌ثانیه نباشد", MinGapMs))
	}
	if c.PreArmSeconds < 0 || c.PreArmSeconds > 600 {
		problems = append(problems, "«شروع زودتر» باید بین ۰ تا ۶۰۰ ثانیه باشد")
	}
	if c.Connections < 0 || c.Connections > MaxConnections {
		problems = append(problems, fmt.Sprintf("تعداد اتصال موازی باید بین ۰ (خودکار) تا %d باشد", MaxConnections))
	}
	if c.TargetHour < 0 || c.TargetHour > 23 ||
		c.TargetMinute < 0 || c.TargetMinute > 59 ||
		c.TargetSecond < 0 || c.TargetSecond > 59 ||
		c.TargetMillis < 0 || c.TargetMillis > 999 {
		problems = append(problems, "ساعت هدف نامعتبر است")
	}

	price, err := c.ResolvePrice(limits)
	if err != nil {
		return append(problems, err.Error())
	}
	if price <= 0 {
		return append(problems, "قیمت باید مثبت باشد")
	}
	// فقط قیمت دستی را با دامنه می‌سنجیم؛ سقف و کف خودشان از کارگزاری آمده‌اند.
	if c.PriceMode == PriceLimit {
		if limits.UpperPrice > 0 && float64(price) > limits.UpperPrice {
			problems = append(problems, fmt.Sprintf("قیمت %s از سقف مجاز (%s) بیشتر است",
				comma(price), comma(int64(limits.UpperPrice))))
		}
		if limits.LowerPrice > 0 && float64(price) < limits.LowerPrice {
			problems = append(problems, fmt.Sprintf("قیمت %s از کف مجاز (%s) کمتر است",
				comma(price), comma(int64(limits.LowerPrice))))
		}
		if limits.Tick > 1 && float64(price) != float64(int64(float64(price)/limits.Tick))*limits.Tick {
			problems = append(problems, fmt.Sprintf("قیمت %s مضربی از گام قیمت (%s) نیست",
				comma(price), comma(int64(limits.Tick))))
		}
	}

	if c.Mode == "api" {
		if strings.TrimSpace(c.OrderURL) == "" {
			problems = append(problems,
				"مسیر ثبت سفارش یاد گرفته نشده: یک‌بار در ایزی‌تریدر سفارشی ثبت کنید "+
					"(با قیمتی دور از بازار، بعد لغوش کنید) یا از «وارد کردن از cURL» استفاده کنید")
		}
		if strings.TrimSpace(c.PayloadTemplate) == "" {
			problems = append(problems, "قالب بدنهٔ سفارش هنوز یاد گرفته نشده است")
		}
		if strings.TrimSpace(c.Token) == "" {
			problems = append(problems, "توکن در دسترس نیست؛ در پنجرهٔ ایزی‌تریدر وارد شوید")
		}
	}
	return problems
}

// comma عدد را سه‌رقم سه‌رقم جدا می‌کند.
func comma(value int64) string {
	sign := ""
	if value < 0 {
		sign, value = "-", -value
	}
	digits := fmt.Sprintf("%d", value)
	var parts []string
	for len(digits) > 3 {
		parts = append([]string{digits[len(digits)-3:]}, parts...)
		digits = digits[:len(digits)-3]
	}
	parts = append([]string{digits}, parts...)
	return sign + strings.Join(parts, ",")
}
