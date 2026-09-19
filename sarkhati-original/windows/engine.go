package main

import (
	"fmt"
	"strings"
	"sync"
	"time"
	_ "time/tzdata" // پایگاه دادهٔ مناطق زمانی داخل فایل اجرایی جاسازی می‌شود
)

// prepareBefore چند وقت مانده به هدف، اتصال‌ها برقرار شوند.
const prepareBefore = 45 * time.Second

// warmUntil تا این فاصله مانده به شلیک، اتصال گرم نگه داشته می‌شود.
const warmUntil = 1200 * time.Millisecond

// keepAliveEvery فاصلهٔ گرم‌کردن اتصال در زمان انتظار.
const keepAliveEvery = 4 * time.Second

// pastGrace اگر لحظهٔ هدف تازه گذشته باشد، همان را می‌گیریم و فوراً شلیک
// می‌کنیم؛ به فردا موکول نمی‌شود.
const pastGrace = 2 * time.Second

// fullSyncNeeds همگام‌سازی کامل ساعت تا این اندازه وقت می‌خواهد؛ کمتر از این
// مانده باشد، سراغ راه‌های سریع‌تر می‌رویم.
const fullSyncNeeds = 6 * time.Second

// shortFuse فاصلهٔ کمتر از این یعنی وقتِ مقدمات نیست: اندازه‌گیری شبکه و
// همگام‌سازی دوبارهٔ ساعت کنار گذاشته می‌شود تا شلیک از دست نرود.
const shortFuse = 25 * time.Second

// spinWindow در این بازهٔ آخر به‌جای خواب، حلقهٔ اشغال می‌چرخد.
// خواب سیستم‌عامل خطای چند میلی‌ثانیه‌ای دارد؛ حلقهٔ اشغال ندارد.
const spinWindow = 20 * time.Millisecond

var ntpServers = []string{"ntp.sharif.edu", "pool.ntp.org", "time.google.com"}

// Tehran منطقهٔ زمانی ایران (از ۱۴۰۱ بدون ساعت تابستانی).
func Tehran() *time.Location {
	if loc, err := time.LoadLocation("Asia/Tehran"); err == nil {
		return loc
	}
	return time.FixedZone("Asia/Tehran", 3*3600+1800)
}

// State وضعیت زندهٔ اجرا که رابط کاربری هر ۲۵۰ میلی‌ثانیه می‌خواند.
type State struct {
	Running       bool     `json:"running"`
	Finished      bool     `json:"finished"`
	Accepted      bool     `json:"accepted"`
	ClockText     string   `json:"clock_text"`
	OffsetMs      float64  `json:"offset_ms"`
	TargetEpochMs int64    `json:"target_epoch_ms"`
	RemainingMs   int64    `json:"remaining_ms"`
	Summary       string   `json:"summary"`
	Attempts      int      `json:"attempts"`
	RateHz        float64  `json:"rate_hz"`
	Skipped       int      `json:"skipped"`
	Connections   int      `json:"connections"`
	LastDetail    string   `json:"last_detail"`
	Log           []string `json:"log"`
}

// Engine اجرای یک سرخطی را مدیریت می‌کند.
type Engine struct {
	mu     sync.Mutex
	state  State
	cancel chan struct{}
	clock  Clock

	// lastLead آخرین پیش‌فرست اندازه‌گیری‌شده؛ وقتی تا هدف وقتی نمانده،
	// به‌جای اندازه‌گیری دوباره از همین استفاده می‌شود.
	lastLead time.Duration
	leadAt   time.Time

	// BrokerClock ساعت خود کارگزار؛ اگر در دسترس باشد بر هر منبع دیگری
	// ارجح است، چون سفارش با همان ساعت سنجیده می‌شود.
	BrokerClock func(samples int) (Clock, error)
}

func NewEngine() *Engine {
	e := &Engine{}
	e.clock = LocalClock()
	e.state.ClockText = "ساعت هنوز همگام نشده است"
	return e
}

func (e *Engine) Snapshot() State {
	e.mu.Lock()
	defer e.mu.Unlock()
	copied := e.state
	copied.Log = append([]string(nil), e.state.Log...)
	return copied
}

func (e *Engine) Clock() Clock {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.clock
}

func (e *Engine) logf(format string, args ...interface{}) {
	line := fmt.Sprintf("%s  %s", time.Now().In(Tehran()).Format("15:04:05.000"),
		fmt.Sprintf(format, args...))
	e.mu.Lock()
	defer e.mu.Unlock()
	e.state.Log = append(e.state.Log, line)
	if len(e.state.Log) > 200 {
		e.state.Log = e.state.Log[len(e.state.Log)-200:]
	}
}

func (e *Engine) setClock(c Clock) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.clock = c
	e.state.ClockText = c.Describe()
	e.state.OffsetMs = c.OffsetMillis()
}

// rememberLead پیش‌فرست اندازه‌گیری‌شده را برای استفادهٔ بعدی نگه می‌دارد.
func (e *Engine) rememberLead(lead time.Duration) {
	e.mu.Lock()
	e.lastLead = lead
	e.leadAt = time.Now()
	e.mu.Unlock()
}

// cachedLead پیش‌فرستِ تازه (کمتر از ۵ دقیقه) را برمی‌گرداند.
func (e *Engine) cachedLead() (time.Duration, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.leadAt.IsZero() || time.Since(e.leadAt) > 5*time.Minute {
		return 0, false
	}
	return e.lastLead, true
}

// Sync ساعت را همگام می‌کند و نتیجه را در وضعیت می‌گذارد.
func (e *Engine) Sync(baseURL string) Clock {
	if e.BrokerClock != nil {
		if clock, err := e.BrokerClock(4); err == nil && clock.Uncertainty <= 200*time.Millisecond {
			e.setClock(clock)
			e.logf("ساعت همگام شد — %s", clock.Describe())
			return clock
		}
	}
	clock := SyncClock(baseURL, ntpServers, 50*time.Millisecond)
	e.setClock(clock)
	e.logf("ساعت همگام شد — %s", clock.Describe())
	return clock
}

// syncWithin ساعت را در حد وقتی که مانده همگام می‌کند.
//
// همگام‌سازی کامل (لبه‌یابی هدر Date) تا سه ثانیه طول می‌کشد؛ اگر تا لحظهٔ
// هدف کمتر از این مانده باشد، همگام‌سازی کامل خودِ شلیک را از بین می‌برد. پس
// وقتی وقت تنگ است فقط ساعت خود کارگزار — که چند رفت‌وبرگشت بیشتر نیست —
// پرسیده می‌شود، و اگر آن هم نبود با ساعت فعلی ادامه می‌دهیم.
func (e *Engine) syncWithin(baseURL string, budget time.Duration) Clock {
	if budget >= fullSyncNeeds {
		e.logf("در حال همگام‌سازی ساعت…")
		return e.Sync(baseURL)
	}
	if e.BrokerClock != nil {
		samples := 2
		if budget < 1500*time.Millisecond {
			samples = 1
		}
		if clock, err := e.BrokerClock(samples); err == nil && clock.Uncertainty <= 200*time.Millisecond {
			e.setClock(clock)
			e.logf("ساعت کارگزار خوانده شد — %s", clock.Describe())
			return clock
		}
	}
	e.logf("وقت کافی برای همگام‌سازی کامل ساعت نبود؛ با ساعت فعلی ادامه می‌دهیم")
	return e.Clock()
}

// Cancel اجرای در جریان را متوقف می‌کند.
func (e *Engine) Cancel() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cancel != nil {
		close(e.cancel)
		e.cancel = nil
	}
}

func (e *Engine) cancelled() bool {
	e.mu.Lock()
	ch := e.cancel
	e.mu.Unlock()
	if ch == nil {
		return true
	}
	select {
	case <-ch:
		return true
	default:
		return false
	}
}

// Arm اجرا را در پس‌زمینه شروع می‌کند.
func (e *Engine) Arm(cfg Config, limits Limits) error {
	e.mu.Lock()
	if e.state.Running {
		e.mu.Unlock()
		return fmt.Errorf("یک اجرا از قبل در جریان است")
	}
	// لحظهٔ هدف همین‌جا — لحظهٔ فشردن دکمه — قفل می‌شود.
	//
	// قبلاً بعد از همگام‌سازی ساعت و اندازه‌گیری شبکه حساب می‌شد و آن
	// مقدمات چند ثانیه طول می‌کشید؛ پس هدفی که چند ثانیه بیشتر فاصله
	// نداشت «گذشته» به حساب می‌آمد و به فردا می‌افتاد. حالا هر وقت دکمه
	// را بزنید، همان لحظهٔ هدف ثبت می‌شود.
	// مبدأ محاسبه، لحظهٔ فشردن دکمه است نه لحظهٔ رسیدن درخواست؛ پنجرهٔ تأیید
	// و بررسی سفارش چند ثانیه وقت می‌گیرد و بدون این تصحیح، هدفِ نزدیک از
	// دست می‌رفت.
	clicked := cfg.ClickAgoMs
	if clicked < 0 || clicked > 5*60*1000 {
		clicked = 0
	}
	target := NextOccurrenceAt(e.clock.Now().Add(-time.Duration(clicked)*time.Millisecond),
		cfg.TargetHour, cfg.TargetMinute, cfg.TargetSecond, cfg.TargetMillis)
	e.cancel = make(chan struct{})
	e.state = State{
		Running:       true,
		ClockText:     e.state.ClockText,
		TargetEpochMs: target.UnixMilli(),
		RemainingMs:   e.clock.Until(target).Milliseconds(),
	}
	e.mu.Unlock()

	go func() {
		accepted, summary := e.run(cfg, limits, target)
		e.mu.Lock()
		e.state.Running = false
		e.state.Finished = true
		e.state.Accepted = accepted
		e.state.Summary = summary
		e.state.RemainingMs = 0
		e.cancel = nil
		e.mu.Unlock()
	}()
	return nil
}

func (e *Engine) run(cfg Config, limits Limits, target time.Time) (bool, string) {
	if problems := cfg.Validate(limits); len(problems) > 0 {
		for _, p := range problems {
			e.logf("✗ %s", p)
		}
		return false, "سفارش معتبر نیست"
	}
	price, err := cfg.ResolvePrice(limits)
	if err != nil {
		return false, err.Error()
	}
	e.logf("قیمت ارسالی %s ریال — ارزش کل %s ریال", comma(price), comma(price*cfg.Quantity))

	// هیچ حداقلی برای فاصلهٔ تا هدف وجود ندارد: اگر وقت تنگ باشد، مقدمات
	// کوتاه می‌شود، ولی اجرا هرگز رد نمی‌شود.
	clock := e.Clock()
	hurry := clock.Until(target) < shortFuse
	e.logf("لحظهٔ هدف %s به وقت تهران (%.1f ثانیه دیگر)",
		target.In(Tehran()).Format("2006-01-02 15:04:05.000"), clock.Until(target).Seconds())

	if hurry && clock.Fresh() {
		e.logf("وقت تنگ است؛ با همگام‌سازی قبلی ساعت کار می‌کنیم — %s", clock.Describe())
	} else {
		clock = e.syncWithin(cfg.BaseURL, clock.Until(target))
	}
	if clock.Uncertainty > time.Second {
		return false, fmt.Sprintf("عدم‌قطعیت ساعت (±%.0f ms) بیش از حد مجاز است؛ ارسال متوقف شد",
			float64(clock.Uncertainty)/float64(time.Millisecond))
	}
	if clock.Uncertainty > 50*time.Millisecond {
		e.logf("هشدار: عدم‌قطعیت ساعت ±%.0f ms است؛ دقت شلیک کمتر خواهد بود",
			float64(clock.Uncertainty)/float64(time.Millisecond))
	}

	lead := time.Duration(cfg.LeadMs) * time.Millisecond
	if cfg.LeadMs < 0 {
		if cached, ok := e.cachedLead(); ok && hurry {
			lead = cached
			e.logf("وقت تنگ است؛ پیش‌فرست از اندازه‌گیری قبلی برداشته شد")
		} else if hurry {
			lead = 0
			e.logf("وقت تنگ است؛ اندازه‌گیری شبکه انجام نشد")
		} else {
			lead = e.measureLead(cfg.BaseURL)
			e.rememberLead(lead)
		}
	}
	e.logf("پیش‌فرست %.0f ms", float64(lead)/float64(time.Millisecond))

	e.mu.Lock()
	e.state.TargetEpochMs = target.UnixMilli()
	e.mu.Unlock()

	// حساب‌ها: حساب اصلی (همان که در مرورگر باز است) و هر حساب دیگری که فعال
	// و آماده باشد. هر کدام اتصال‌ها و شمارنده‌های خودش را دارد.
	lanes := e.buildLanes(cfg, lead)
	defer func() {
		for _, l := range lanes {
			l.sender.Close()
		}
	}()

	// فاز ۱: انتظار طولانی تا آستانهٔ آماده‌سازی
	if !e.waitUntil(clock, target.Add(-lead-prepareBefore), true) {
		return false, "لغو شد"
	}
	e.logf("در حال آماده‌سازی…")
	ready, err := e.prepareLanes(lanes, price)
	if err != nil {
		return false, err.Error()
	}
	lanes = ready
	e.logf("آماده است")

	// فاز ۲: اتصال را تا نزدیکِ لحظهٔ شلیک گرم نگه می‌داریم.
	//
	// اتصالی که چند ثانیه بی‌کار بماند ممکن است از سمت سرور بسته شود؛ آن‌وقت
	// *اولین* تلاش — که تنها تلاش مهم است — باید دوباره اتصال بسازد و صدها
	// میلی‌ثانیه دیر می‌رسد.
	fireAt := target.Add(-lead)
	lastWarm := time.Now()
	for !e.cancelled() {
		remaining := clock.Until(fireAt)
		if remaining <= warmUntil {
			break
		}
		e.setRemaining(remaining)
		sleep := remaining / 4
		if sleep > time.Second {
			sleep = time.Second
		}
		time.Sleep(sleep)
		if time.Since(lastWarm) >= keepAliveEvery {
			for _, l := range lanes {
				l.sender.KeepAlive()
			}
			lastWarm = time.Now()
		}
	}
	// گرم‌کردن نهایی، درست قبل از شلیک.
	if !e.cancelled() && time.Since(lastWarm) > time.Second {
		for _, l := range lanes {
			l.sender.KeepAlive()
		}
	}
	if e.cancelled() {
		return false, "لغو شد"
	}

	// فاز ۳: شلیک
	//
	// دو حالت: تا وقتی کاربر متوقف کند، یا تعداد مشخص. در هر دو حالت هر حساب
	// با پذیرش سفارش خودش یا خطای احراز هویت فوراً می‌ایستد.
	return e.fireLanes(cfg, clock, lanes, fireAt)
}

// buildLanes یک خط ارسال برای حساب اصلی و هر حساب فعالِ دیگر می‌سازد.
func (e *Engine) buildLanes(cfg Config, lead time.Duration) []*lane {
	build := func(name string, laneCfg Config) *lane {
		laneCfg.Connections = planConnections(laneCfg, 2*lead)
		sender := newSender(laneCfg)
		// زمانِ داخل سفارش با ساعت کارگزار نوشته می‌شود، نه ساعت ویندوز.
		if clocked, ok := sender.(clockedSender); ok {
			clocked.UseClock(func() time.Time { return e.Clock().Now() })
		}
		return &lane{name: name, cfg: laneCfg, sender: sender}
	}

	lanes := []*lane{build("", cfg)}
	accounts := ActiveAccounts(cfg)
	for _, account := range accounts {
		lanes = append(lanes, build(account.Name, account.Apply(cfg)))
	}

	connections := 0
	for _, l := range lanes {
		connections += l.cfg.Connections
	}
	if len(accounts) > 0 {
		e.logf("%d حساب هم‌زمان سفارش می‌دهند: %s", len(lanes), laneNames(lanes))
	}
	e.logf("%d اتصال موازی برای فاصلهٔ %d میلی‌ثانیه", connections, cfg.RetryGapMs)
	e.setRate(0, 0, connections)
	return lanes
}

func laneNames(lanes []*lane) string {
	names := make([]string, 0, len(lanes))
	for _, l := range lanes {
		names = append(names, l.displayName())
	}
	return strings.Join(names, "، ")
}

// prepareLanes اتصال‌های همهٔ حساب‌ها را هم‌زمان برقرار می‌کند.
//
// شکست حساب اصلی یعنی توقف کامل؛ شکست یک حساب دیگر فقط همان حساب را کنار
// می‌گذارد — یک توکن منقضی نباید سرخطیِ بقیه را از بین ببرد.
func (e *Engine) prepareLanes(lanes []*lane, price int64) ([]*lane, error) {
	type outcome struct {
		lane *lane
		err  error
	}
	results := make(chan outcome, len(lanes))
	for _, l := range lanes {
		go func(l *lane) { results <- outcome{l, l.sender.Prepare(price)} }(l)
	}
	failures := make(map[*lane]error, len(lanes))
	for range lanes {
		got := <-results
		if got.err != nil {
			failures[got.lane] = got.err
		}
	}

	ready := make([]*lane, 0, len(lanes))
	for index, l := range lanes {
		err, failed := failures[l]
		if !failed {
			ready = append(ready, l)
			continue
		}
		if index == 0 {
			return nil, fmt.Errorf("آماده‌سازی ناموفق: %v", err)
		}
		e.logf("✗ حساب «%s» کنار گذاشته شد: %v", l.displayName(), err)
		l.sender.Close()
	}
	return ready, nil
}

// lane یک حساب کارگزاری در یک شلیک.
//
// هر حساب فرستنده، استخر اتصال و شمارنده‌های خودش را دارد و مستقل از بقیه
// می‌ایستد: پذیرش سفارش یک حساب، بقیه را متوقف نمی‌کند.
type lane struct {
	name   string
	cfg    Config
	sender Sender

	jobs    chan fireJob
	workers int

	sent     int
	done     int
	rejected int
	skipped  int
	accepted bool
	fatal    bool
	last     string
}

// label پیشوند نام حساب در گزارش؛ برای تک‌حساب خالی است.
func (l *lane) label() string {
	if l.name == "" {
		return ""
	}
	return "[" + l.name + "] "
}

func (l *lane) finished() bool { return l.accepted || l.fatal }

// fireJob یک نوبت ارسال در برنامهٔ زمانی شلیک.
type fireJob struct {
	attempt   int
	scheduled time.Time
}

// fireOutcome نتیجهٔ یک نوبت، با زمان‌بندی واقعی‌اش.
type fireOutcome struct {
	lane    *lane
	job     fireJob
	sentAt  time.Time
	latency time.Duration
	result  Result
}

// fire شلیک تک‌حسابی — همان مسیر همیشگی.
func (e *Engine) fire(cfg Config, clock Clock, sender Sender, fireAt time.Time) (bool, string) {
	return e.fireLanes(cfg, clock, []*lane{{cfg: cfg, sender: sender}}, fireAt)
}

// fireLanes حلقهٔ ارسال را از لحظهٔ هدف، برای همهٔ حساب‌ها، اجرا می‌کند.
//
// زمان‌بند و فرستنده از هم جدا هستند. قبلاً یک حلقه هم زمان‌بندی می‌کرد و هم
// منتظر پاسخ می‌ماند؛ چون پاسخ کارگزار حدود ۶۰ میلی‌ثانیه طول می‌کشد، نرخ
// واقعی روی ۱۶ ارسال در ثانیه قفل شده بود، هرچه هم فاصله را کم می‌کردید. حالا
// زمان‌بند فقط نوبت‌ها را سرِ وقت به استخر کارگران می‌سپارد و هیچ‌وقت منتظر
// پاسخ نمی‌ماند، پس فاصلهٔ واقعی همان فاصلهٔ خواسته‌شده است.
func (e *Engine) fireLanes(cfg Config, clock Clock, lanes []*lane, fireAt time.Time) (bool, string) {
	if len(lanes) == 0 {
		return false, "هیچ حسابی برای ارسال نیست"
	}
	// اگر لحظهٔ شلیک گذشته باشد (هدفِ خیلی نزدیک یا مقدماتی که طول کشید)،
	// همین حالا شروع می‌کنیم؛ نه رگبارِ جبرانی می‌زنیم و نه چیزی را از
	// دست می‌دهیم.
	if clock.Until(fireAt) < 0 {
		e.logf("لحظهٔ هدف گذشته است؛ شلیک از همین حالا شروع می‌شود")
		fireAt = clock.Now()
	}
	gap := time.Duration(cfg.RetryGapMs) * time.Millisecond
	if gap < MinGapMs*time.Millisecond {
		gap = MinGapMs * time.Millisecond
	}
	limit := MaxAttempts
	if cfg.FireMode == FireCount {
		limit = cfg.Retries
		if limit < 1 {
			limit = 1
		}
	}
	maxDuration := time.Duration(cfg.MaxDurationS) * time.Second
	if maxDuration <= 0 {
		maxDuration = 3 * time.Minute
	}

	outcomes := make(chan fireOutcome, 64)
	var wg sync.WaitGroup
	// اختلاف ساعت محلی با ساعت سرور، برای اینکه زمان ارسال را روی ساعت سرور
	// گزارش کنیم بدون اینکه در مسیر داغ چیزی محاسبه شود.
	skew := clock.Now().Sub(time.Now())
	totalWorkers := 0
	for _, l := range lanes {
		l.workers = senderParallelism(l.sender)
		totalWorkers += l.workers
		// کانال بدون بافر: نوبت فقط به کارگری سپرده می‌شود که همین حالا آزاد
		// است. با بافر، نوبت‌ها در صف می‌ماندند و دیرتر از زمان مقررشان روی
		// سیم می‌رفتند — همان چیزی که به شکل «خطای زمانی +۱۳ ثانیه» دیده شد.
		l.jobs = make(chan fireJob)
		for i := 0; i < l.workers; i++ {
			wg.Add(1)
			// کانال به‌عنوان پارامتر داده می‌شود، نه از روی l.jobs خوانده شود:
			// اگر کارگری دیر زمان‌بندی شود و تا آن موقع l.jobs پاک شده باشد،
			// روی کانال nil برای همیشه معطل می‌ماند و انتظارِ پایانِ شلیک
			// هیچ‌وقت تمام نمی‌شود.
			go func(l *lane, jobs <-chan fireJob) {
				defer wg.Done()
				for job := range jobs {
					started := time.Now()
					result := l.sender.Send(job.attempt)
					outcomes <- fireOutcome{
						lane:    l,
						job:     job,
						sentAt:  started.Add(skew),
						latency: time.Since(started),
						result:  result,
					}
				}
			}(l, l.jobs)
		}
	}
	// اگر وسط کار برگشتیم، کارگران نباید معطل بمانند. (مسیر عادی همان
	// drainOutcomes است که خودش می‌بندد.)
	defer func() {
		for _, l := range lanes {
			if l.jobs != nil {
				close(l.jobs)
				l.jobs = nil
			}
		}
	}()

	who := ""
	if len(lanes) > 1 {
		who = fmt.Sprintf(" روی %d حساب", len(lanes))
	}
	if cfg.FireMode == FireCount {
		e.logf("شلیک%s: %d ارسال با فاصلهٔ %d میلی‌ثانیه روی %d اتصال موازی",
			who, limit, gap.Milliseconds(), totalWorkers)
	} else {
		e.logf("شلیک پیوسته%s تا وقتی متوقف کنید — فاصلهٔ %d میلی‌ثانیه روی %d اتصال موازی (سقف %s)",
			who, gap.Milliseconds(), totalWorkers, maxDuration)
	}

	var (
		sent, done  int
		lastLogged  time.Time
		anyAccepted bool
	)

	handle := func(o fireOutcome) {
		l := o.lane
		l.done++
		done++
		e.setProgress(sent, o.result.Detail)
		line := fmt.Sprintf("%sتلاش %d: خطای زمانی %+.1f ms | پاسخ %.0f ms | %s — %s",
			l.label(), o.job.attempt+1,
			float64(o.sentAt.Sub(o.job.scheduled))/float64(time.Millisecond),
			float64(o.latency)/float64(time.Millisecond),
			map[bool]string{true: "پذیرفته", false: "رد"}[o.result.Accepted], o.result.Detail)
		l.last = line
		// اولین تلاش و هر ثانیه یک‌بار لاگ می‌شود؛ صدها خط یکسان،
		// گزارش را بی‌فایده می‌کند.
		if o.job.attempt == 0 || o.result.Accepted || o.result.Fatal ||
			time.Since(lastLogged) >= time.Second {
			e.logf("%s", line)
			lastLogged = time.Now()
		}
		if o.result.Accepted {
			if !l.accepted {
				e.logf("✓ %sسفارش پذیرفته شد در تلاش %d", l.label(), o.job.attempt+1)
				if inflight := l.sent - l.done; inflight > 0 {
					e.logf("توجه: %s%d درخواست در همان لحظه در پرواز بود؛ اگر کارگزار آن‌ها را هم "+
						"بپذیرد بیش از یک سفارش ثبت می‌شود", l.label(), inflight)
				}
			}
			l.accepted, anyAccepted = true, true
			return
		}
		if o.result.Fatal {
			if !l.fatal {
				e.logf("%sشلیک متوقف شد: %s", l.label(), o.result.Detail)
			}
			l.fatal = true
			return
		}
		l.rejected++
	}

	drain := func() {
		for {
			select {
			case o := <-outcomes:
				handle(o)
			default:
				return
			}
		}
	}

	active := func() bool {
		for _, l := range lanes {
			if !l.finished() && l.sent < limit {
				return true
			}
		}
		return false
	}

	// زمان‌بند: هر نوبت را سرِ وقتش می‌سپارد و بلافاصله سراغ نوبت بعد می‌رود.
	rateAt := clock.Now()
	rateSent := 0
	skipped := 0
	for slot := 0; !e.cancelled() && active(); slot++ {
		scheduled := fireAt.Add(time.Duration(slot) * gap)
		if clock.Until(scheduled) > 0 {
			e.waitUntil(clock, scheduled, false)
		}
		// نتیجه‌های آماده *قبل* از سپردن نوبت بعد خوانده می‌شوند: اگر سفارش
		// پذیرفته شده باشد، یک ارسال اضافه هم نمی‌رود.
		drain()
		if !active() || e.cancelled() {
			break
		}
		now := clock.Now()
		if now.Sub(fireAt) > maxDuration {
			e.logf("شلیک پس از %s متوقف شد (سقف مدت)", maxDuration)
			break
		}
		for _, l := range lanes {
			if l.finished() || l.sent >= limit {
				continue
			}
			select {
			case l.jobs <- fireJob{attempt: l.sent, scheduled: scheduled}:
				l.sent++
				sent++
			default:
				// همهٔ اتصال‌های این حساب مشغول‌اند: این نوبت را رد می‌کنیم تا
				// صفِ عقب‌افتاده درست نشود. با اتصال بیشتر یا فاصلهٔ بزرگ‌تر،
				// این عدد صفر می‌ماند.
				l.skipped++
				skipped++
			}
		}
		e.setSent(sent)
		if elapsed := now.Sub(rateAt); elapsed >= time.Second {
			hz := float64(sent-rateSent) / elapsed.Seconds()
			e.setRate(hz, skipped, totalWorkers)
			e.logf("نرخ ارسال: %.0f در ثانیه | %d ارسال‌شده | %d پاسخ | %d جاافتاده",
				hz, sent, done, skipped)
			rateAt, rateSent = now, sent
		}
	}

	stoppedBy := ""
	if e.cancelled() {
		stoppedBy = "با دستور شما"
	} else if !active() && cfg.FireMode != FireCount {
		for _, l := range lanes {
			if l.sent >= limit {
				e.logf("%sبه سقف %d ارسال رسید", l.label(), limit)
			}
		}
	}

	// پاسخ ارسال‌هایی که در پرواز مانده‌اند هنوز مهم است: ممکن است یکی از
	// همان‌ها پذیرفته شده باشد.
	e.drainOutcomes(lanes, outcomes, handle, &wg)

	total := clock.Now().Sub(fireAt)
	if total > 0 && sent > 0 {
		e.setRate(float64(sent)/total.Seconds(), skipped, totalWorkers)
		e.logf("پایان شلیک: %d ارسال در %.1f ثانیه (%.0f در ثانیه)، %d جاافتاده %s",
			sent, total.Seconds(), float64(sent)/total.Seconds(), skipped, stoppedBy)
	}

	summary := laneSummary(lanes)
	if len(lanes) > 1 {
		e.logf("%s", summary)
	}
	return anyAccepted, summary
}

// drainOutcomes منتظر پاسخ ارسال‌های در پرواز می‌ماند.
func (e *Engine) drainOutcomes(lanes []*lane, outcomes chan fireOutcome,
	handle func(fireOutcome), wg *sync.WaitGroup) {
	for _, l := range lanes {
		close(l.jobs)
		l.jobs = nil
	}
	finished := make(chan struct{})
	go func() { wg.Wait(); close(finished) }()
	timeout := time.After(12 * time.Second)
	for {
		select {
		case o := <-outcomes:
			handle(o)
		case <-finished:
			for {
				select {
				case o := <-outcomes:
					handle(o)
				default:
					return
				}
			}
		case <-timeout:
			return
		}
	}
}

// laneSummary خلاصهٔ نتیجهٔ هر حساب.
func laneSummary(lanes []*lane) string {
	if len(lanes) == 1 {
		if lanes[0].last == "" {
			return "تلاشی انجام نشد"
		}
		return lanes[0].last
	}
	parts := make([]string, 0, len(lanes))
	for _, l := range lanes {
		state := "رد شد"
		switch {
		case l.accepted:
			state = "پذیرفته شد"
		case l.fatal:
			state = "خطای قطعی"
		case l.sent == 0:
			state = "ارسالی انجام نشد"
		}
		parts = append(parts, fmt.Sprintf("%s: %s (%d ارسال)", l.displayName(), state, l.sent))
	}
	return strings.Join(parts, " | ")
}

func (l *lane) displayName() string {
	if l.name == "" {
		return "حساب اصلی"
	}
	return l.name
}

// planConnections تعداد اتصال موازی لازم را حساب می‌کند.
//
// هر اتصال در هر «زمان پاسخ» فقط یک ارسال می‌تواند انجام دهد. پس برای رسیدن
// به فاصلهٔ خواسته‌شده، به «زمان پاسخ ÷ فاصله» اتصال نیاز داریم؛ با پاسخ ۶۰ و
// فاصلهٔ ۲۰ میلی‌ثانیه یعنی چهار اتصال، و با فاصلهٔ ۵ میلی‌ثانیه سیزده اتصال.
func planConnections(cfg Config, rtt time.Duration) int {
	if cfg.Connections > 0 {
		if cfg.Connections > MaxConnections {
			return MaxConnections
		}
		return cfg.Connections
	}
	gap := time.Duration(cfg.RetryGapMs) * time.Millisecond
	if gap < MinGapMs*time.Millisecond {
		gap = MinGapMs * time.Millisecond
	}
	if rtt <= 0 {
		rtt = 80 * time.Millisecond // تخمین محافظه‌کارانه وقتی اندازه‌گیری نداریم
	}
	// یک اتصال بیشتر از حساب، برای نوساناتِ زمان پاسخ.
	needed := int((rtt+gap-1)/gap) + 1
	if needed < 2 {
		needed = 2
	}
	if needed > MaxConnections {
		needed = MaxConnections
	}
	return needed
}

// setProgress شمارندهٔ تلاش‌ها را برای رابط کاربری به‌روز می‌کند.
func (e *Engine) setProgress(attempts int, detail string) {
	e.mu.Lock()
	e.state.Attempts = attempts
	e.state.LastDetail = detail
	e.mu.Unlock()
}

// setSent فقط شمارندهٔ ارسال را جلو می‌برد، بدون دست‌زدن به آخرین پاسخ.
func (e *Engine) setSent(sent int) {
	e.mu.Lock()
	e.state.Attempts = sent
	e.mu.Unlock()
}

// setRate نرخ زندهٔ ارسال را برای رابط کاربری می‌گذارد.
func (e *Engine) setRate(hz float64, skipped, connections int) {
	e.mu.Lock()
	e.state.RateHz = hz
	e.state.Skipped = skipped
	if connections > 0 {
		e.state.Connections = connections
	}
	e.mu.Unlock()
}

func (e *Engine) setRemaining(d time.Duration) {
	e.mu.Lock()
	e.state.RemainingMs = d.Milliseconds()
	e.mu.Unlock()
}

// waitUntil تا لحظهٔ مشخص روی ساعت سرور صبر می‌کند.
//
// خواب سیستم‌عامل تا چند میلی‌ثانیه خطا دارد، پس تا spinWindow مانده می‌خوابیم
// و باقی را با حلقهٔ اشغال می‌شماریم. خروجی false یعنی کاربر لغو کرده است.
func (e *Engine) waitUntil(clock Clock, target time.Time, report bool) bool {
	for !e.cancelled() {
		remaining := clock.Until(target)
		if remaining <= spinWindow {
			break
		}
		if report {
			e.setRemaining(remaining)
		}
		// نصف فاصله را می‌خوابیم تا خطای انباشتهٔ خواب کنترل شود.
		sleep := remaining / 2
		if sleep > 200*time.Millisecond {
			sleep = 200 * time.Millisecond
		}
		time.Sleep(sleep)
	}
	for !e.cancelled() && clock.Until(target) > 0 {
		// حلقهٔ اشغال: تنها راه رسیدن به دقت زیرمیلی‌ثانیه
	}
	return !e.cancelled()
}

// measureLead نصف زمان رفت‌وبرگشت تا کارگزار، تا سفارش سرِ ساعت *برسد*.
func (e *Engine) measureLead(baseURL string) time.Duration {
	rtts := MeasureRTT(baseURL, 6)
	if len(rtts) == 0 {
		e.logf("اندازه‌گیری تأخیر شبکه ممکن نشد؛ پیش‌فرست صفر")
		return 0
	}
	return rtts[len(rtts)/2] / 2
}

// NextOccurrenceAt نزدیک‌ترین وقوع آیندهٔ ساعت هدف به وقت تهران.
func NextOccurrenceAt(now time.Time, hour, minute, second, millis int) time.Time {
	loc := Tehran()
	local := now.In(loc)
	candidate := time.Date(local.Year(), local.Month(), local.Day(),
		hour, minute, second, millis*int(time.Millisecond), loc)
	// اگر لحظهٔ هدف تازه گذشته باشد، همان امروز را نگه می‌داریم تا فوراً
	// شلیک شود؛ فقط وقتی واقعاً مربوط به امروز نیست به فردا می‌رود.
	if !candidate.After(local) && local.Sub(candidate) > pastGrace {
		candidate = candidate.AddDate(0, 0, 1)
	}
	return candidate
}

// newSender مسیر ارسال را بر اساس حالت انتخاب‌شده می‌سازد.
//
// شبیه‌سازی حذف شده است: هر ارسالی واقعی است.
func newSender(cfg Config) Sender {
	if cfg.Mode == "desktop" {
		return NewDesktopSender(cfg)
	}
	return NewAPISender(cfg)
}

// SendNow سفارش را همین حالا می‌فرستد، بدون زمان‌بندی.
//
// این همان دکمهٔ «ارسال سفارش» است: برای وقتی که بازار باز است و سرخطی
// موضوعیت ندارد.
func (e *Engine) SendNow(cfg Config, limits Limits) (bool, string) {
	if problems := cfg.Validate(limits); len(problems) > 0 {
		for _, problem := range problems {
			e.logf("✗ %s", problem)
		}
		return false, "سفارش معتبر نیست"
	}
	price, err := cfg.ResolvePrice(limits)
	if err != nil {
		return false, err.Error()
	}
	sender := newSender(cfg)
	defer sender.Close()
	if clocked, ok := sender.(clockedSender); ok {
		clocked.UseClock(func() time.Time { return e.Clock().Now() })
	}

	if err := sender.Prepare(price); err != nil {
		e.logf("✗ آماده‌سازی ناموفق: %v", err)
		return false, fmt.Sprintf("آماده‌سازی ناموفق: %v", err)
	}
	started := time.Now()
	result := sender.Send(0)
	verdict := "رد"
	if result.Accepted {
		verdict = "پذیرفته"
	}
	line := fmt.Sprintf("ارسال فوری: %s در %s ریال | پاسخ %.0f ms | %s — %s",
		cfg.Symbol, comma(price), float64(time.Since(started))/float64(time.Millisecond),
		verdict, result.Detail)
	e.logf("%s", line)
	return result.Accepted, line
}
