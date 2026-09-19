package main

import (
	"bufio"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Result نتیجهٔ یک تلاش ارسال.
type Result struct {
	Accepted bool
	Detail   string
	// Fatal یعنی تکرار بی‌فایده است (مثل توکن منقضی)؛ حلقهٔ شلیک می‌ایستد.
	Fatal bool
}

// Sender سفارش را روی یک اتصال از پیش گرم‌شده می‌فرستد.
//
// در لحظهٔ شلیک فقط یک Write انجام می‌شود: حل DNS، اتصال TCP و دست‌دادن TLS
// همه در Prepare اتفاق افتاده‌اند.
//
// Send باید برای فراخوانی هم‌زمان امن باشد: حلقهٔ شلیک چند کارگر موازی دارد و
// اگر هر ارسال منتظر پاسخ قبلی بماند، نرخ ارسال به یک‌بر‌رفت‌وبرگشت محدود
// می‌شود (یعنی با پاسخ ۶۰ میلی‌ثانیه‌ای، فقط ۱۶ ارسال در ثانیه).
type Sender interface {
	Prepare(price int64) error
	KeepAlive()
	Send(attempt int) Result
	Close()
}

// parallelSender فرستنده‌ای که چند ارسالِ هم‌زمان را تحمل می‌کند.
//
// حلقهٔ شلیک به همین تعداد کارگر می‌سازد؛ هر فرستنده‌ای که این را پیاده نکند
// تک‌رشته‌ای فرض می‌شود (مثل حالت دسکتاپ که یک نشانگر ماوس بیشتر ندارد).
type parallelSender interface {
	Parallelism() int
}

// clockedSender فرستنده‌ای که زمانِ داخل سفارش را از ساعت همگام‌شده می‌گیرد.
type clockedSender interface {
	UseClock(now func() time.Time)
}

// senderParallelism تعداد ارسال هم‌زمانی که این فرستنده تحمل می‌کند.
func senderParallelism(s Sender) int {
	if p, ok := s.(parallelSender); ok {
		if n := p.Parallelism(); n > 0 {
			return n
		}
	}
	return 1
}

type conn struct {
	net    net.Conn
	reader *bufio.Reader
}

// APISender ارسال از طریق API وب کارگزار (ایزی‌تریدر یا هر OMS دیگر).
//
// اتصال‌ها یک استخر هستند: هر ارسال یک اتصال بی‌کار قرض می‌گیرد، می‌نویسد،
// پاسخ را می‌خواند و اتصال را برمی‌گرداند. چون ارسال‌ها موازی‌اند، نرخ کل
// برابر است با «تعداد اتصال ÷ زمان پاسخ»، نه «یک ÷ زمان پاسخ».
type APISender struct {
	cfg   Config
	host  string
	port  string
	tls   bool
	path  string
	price int64

	idle chan *conn // اتصال‌های آمادهٔ استفاده

	mu   sync.Mutex
	all  []*conn          // برای بستن، شامل اتصال‌های قرض‌داده‌شده
	now  func() time.Time // ساعت مرجع برای زمانِ داخل سفارش
	head []byte           // سربرگ ثابت درخواست، از پیش ساخته
}

func NewAPISender(cfg Config) *APISender {
	return &APISender{cfg: cfg, now: time.Now}
}

// UseClock ساعت مرجع زمانِ داخل سفارش را تعیین می‌کند.
//
// createDateTime باید با ساعت کارگزار بخواند، نه با ساعت ویندوز؛ وگرنه روی
// دستگاهی که ساعتش چند صد میلی‌ثانیه جلو یا عقب است، خودِ سفارش بیرون از
// پنجرهٔ زمانی مجاز به نظر می‌رسد.
func (s *APISender) UseClock(now func() time.Time) {
	if now != nil {
		s.mu.Lock()
		s.now = now
		s.mu.Unlock()
	}
}

func (s *APISender) clockNow() time.Time {
	s.mu.Lock()
	now := s.now
	s.mu.Unlock()
	if now == nil {
		return time.Now()
	}
	return now()
}

// Parallelism تعداد ارسال هم‌زمانی که استخر اتصال‌ها تحمل می‌کند.
func (s *APISender) Parallelism() int { return cap(s.idle) }

// BuildBody قالب کاربر را با مقادیر واقعی پر می‌کند.
//
// دو فیلد باید در هر ارسال از نو ساخته شوند: زمان ثبت، و ارزش کل (که کارگزار
// با احتساب کارمزد می‌فرستد). فرستادن مقدار قدیمی آن‌ها یعنی رد شدن سفارش.
func (s *APISender) BuildBody(price int64) string {
	side := s.cfg.SideBuy
	if s.cfg.Side == "sell" {
		side = s.cfg.SideSell
	}
	if side == "" {
		// کارگزاری‌ها یکسان نیستند؛ این فقط وقتی استفاده می‌شود که سفارش
		// واقعی هنوز دیده نشده باشد.
		if s.cfg.Side == "sell" {
			side = "2"
		} else {
			side = "1"
		}
	}
	isin := s.cfg.ISIN
	if isin == "" {
		isin = s.cfg.Symbol
	}
	replacer := strings.NewReplacer(
		"{isin}", isin,
		"{symbol}", s.cfg.Symbol,
		"{price}", strconv.FormatInt(price, 10),
		"{quantity}", strconv.FormatInt(s.cfg.Quantity, 10),
		"{side}", side,
		"{validity}", "day",
		"{value}", strconv.FormatInt(
			orderTotalValue(price, s.cfg.Quantity, s.cfg.OrderCommission), 10),
		"{now}", formatLikeSample(s.cfg.OrderDateSample, s.clockNow()),
	)
	return replacer.Replace(s.cfg.PayloadTemplate)
}

// buildHead سربرگ ثابت درخواست را یک‌بار می‌سازد (همه‌چیز جز Content-Length).
func (s *APISender) buildHead() []byte {
	var head strings.Builder
	fmt.Fprintf(&head, "POST %s HTTP/1.1\r\n", s.targetPath())
	fmt.Fprintf(&head, "Host: %s\r\n", s.host)
	head.WriteString("Content-Type: application/json\r\n")
	head.WriteString("Accept: application/json\r\n")
	head.WriteString("Connection: keep-alive\r\n")
	// هدرهای همان درخواست واقعیِ ثبت سفارش؛ بعضی کارگزاری‌ها بدون Origin و
	// Referer و هدرهای اختصاصی، سفارش را رد می‌کنند.
	for name, value := range s.cfg.OrderHeaders {
		fmt.Fprintf(&head, "%s: %s\r\n", name, value)
	}
	if s.cfg.Token != "" {
		fmt.Fprintf(&head, "Authorization: Bearer %s\r\n", s.cfg.Token)
	}
	return []byte(head.String())
}

// BuildRequest بایت‌های کامل یک درخواست HTTP را می‌سازد.
//
// بدنه در هر ارسال از نو ساخته می‌شود، نه یک‌بار در Prepare: زمانِ داخل سفارش
// (createDateTime) باید همین حالا باشد. با ساختِ یک‌باره، سفارشی که سرِ ساعت
// می‌رفت زمانی چهل‌وپنج ثانیه قدیمی داشت و کارگزار می‌توانست آن را «خارج از
// محدودهٔ زمانی» بداند. هزینهٔ ساخت چند میکروثانیه است.
func (s *APISender) BuildRequest(price int64) []byte {
	body := s.BuildBody(price)
	head := s.head
	if head == nil {
		head = s.buildHead()
	}
	out := make([]byte, 0, len(head)+len(body)+32)
	out = append(out, head...)
	out = append(out, "Content-Length: "...)
	out = strconv.AppendInt(out, int64(len(body)), 10)
	out = append(out, "\r\n\r\n"...)
	out = append(out, body...)
	return out
}

// targetURL نشانی کاملی که سفارش به آن می‌رود.
func (s *APISender) targetURL() string {
	if target := strings.TrimSpace(s.cfg.OrderURL); target != "" {
		return target
	}
	return strings.TrimRight(s.cfg.BaseURL, "/") + s.cfg.OrderPath
}

// targetPath مسیر درخواست (بدون میزبان).
func (s *APISender) targetPath() string {
	if s.path != "" {
		return s.path
	}
	if parsed, err := url.Parse(s.targetURL()); err == nil && parsed.Path != "" {
		return parsed.RequestURI()
	}
	return s.cfg.OrderPath
}

func (s *APISender) Prepare(price int64) error {
	// نشانی کامل همان درخواستی که یاد گرفته‌ایم مرجع است، نه ترکیب نشانی پایه
	// و مسیر: سفارش ممکن است روی میزبان دیگری از همان کارگزاری باشد و آن‌وقت
	// نتیجه HTTP 404 می‌شود.
	target := s.targetURL()
	parsed, err := url.Parse(target)
	if err != nil || parsed.Host == "" {
		return fmt.Errorf("نشانی ثبت سفارش نامعتبر است: %s", target)
	}
	s.path = parsed.RequestURI()
	s.tls = parsed.Scheme != "http"
	s.host = parsed.Hostname()
	s.port = parsed.Port()
	if s.port == "" {
		if s.tls {
			s.port = "443"
		} else {
			s.port = "80"
		}
	}
	s.price = price
	s.head = s.buildHead()

	s.Close()
	count := s.cfg.Connections
	if count < 1 {
		count = 1
	}
	if count > MaxConnections {
		count = MaxConnections
	}

	// اتصال‌ها هم‌زمان برقرار می‌شوند: شانزده دست‌دادن TLS پشت‌سرهم چند ثانیه
	// طول می‌کشد و آماده‌سازی را عقب می‌اندازد.
	type dialed struct {
		c   *conn
		err error
	}
	results := make(chan dialed, count)
	for i := 0; i < count; i++ {
		go func() {
			c, err := s.dial()
			if err == nil {
				s.warmup(c)
			}
			results <- dialed{c, err}
		}()
	}
	pool := make(chan *conn, count)
	var lastErr error
	for i := 0; i < count; i++ {
		got := <-results
		if got.err != nil {
			lastErr = got.err
			continue
		}
		s.mu.Lock()
		s.all = append(s.all, got.c)
		s.mu.Unlock()
		pool <- got.c
	}
	if len(pool) == 0 {
		return fmt.Errorf("هیچ اتصالی به %s برقرار نشد: %v", s.host, lastErr)
	}
	// ظرفیت استخر همان تعداد اتصالِ واقعاً برقرارشده است.
	s.idle = make(chan *conn, len(pool))
	for len(pool) > 0 {
		s.idle <- <-pool
	}
	return nil
}

func (s *APISender) dial() (*conn, error) {
	dialer := &net.Dialer{Timeout: 8 * time.Second}
	address := net.JoinHostPort(s.host, s.port)

	var raw net.Conn
	var err error
	if s.tls {
		// دست‌دادن TLS همین‌جا تمام می‌شود، نه سرِ ساعت.
		raw, err = tls.DialWithDialer(dialer, "tcp", address, &tls.Config{ServerName: s.host})
	} else {
		raw, err = dialer.Dial("tcp", address)
	}
	if err != nil {
		return nil, err
	}
	if tcp, ok := underlyingTCP(raw); ok {
		tcp.SetNoDelay(true) // بدون تأخیر الگوریتم Nagle
	}
	return &conn{net: raw, reader: bufio.NewReaderSize(raw, 8192)}, nil
}

func underlyingTCP(c net.Conn) (*net.TCPConn, bool) {
	if tcp, ok := c.(*net.TCPConn); ok {
		return tcp, true
	}
	if tlsConn, ok := c.(*tls.Conn); ok {
		tcp, ok := tlsConn.NetConn().(*net.TCPConn)
		return tcp, ok
	}
	return nil, false
}

// warmup یک درخواست بی‌ضرر می‌زند تا مسیر شبکه و پنجرهٔ ازدحام TCP باز شود.
func (s *APISender) warmup(c *conn) error {
	probe := fmt.Sprintf("HEAD / HTTP/1.1\r\nHost: %s\r\nConnection: keep-alive\r\n\r\n", s.host)
	c.net.SetDeadline(time.Now().Add(8 * time.Second))
	if _, err := c.net.Write([]byte(probe)); err != nil {
		return err
	}
	resp, err := http.ReadResponse(c.reader, &http.Request{Method: http.MethodHead})
	if err != nil {
		return err
	}
	io.Copy(io.Discard, resp.Body)
	return resp.Body.Close()
}

// KeepAlive همهٔ اتصال‌های بی‌کار را زنده نگه می‌دارد.
//
// فقط در فاز انتظار صدا زده می‌شود، وقتی هیچ ارسالی در جریان نیست.
func (s *APISender) KeepAlive() {
	count := len(s.idle)
	for i := 0; i < count; i++ {
		select {
		case c := <-s.idle:
			if err := s.warmup(c); err != nil {
				s.idle <- s.replace(c)
				continue
			}
			s.idle <- c
		default:
			return
		}
	}
}

// replace اتصال مرده را با اتصال تازه عوض می‌کند (اگر ممکن باشد).
func (s *APISender) replace(dead *conn) *conn {
	dead.net.Close()
	fresh, err := s.dial()
	if err != nil {
		return dead // بعداً باز هم تلاش می‌شود
	}
	s.mu.Lock()
	for i, c := range s.all {
		if c == dead {
			s.all[i] = fresh
			break
		}
	}
	s.mu.Unlock()
	return fresh
}

// leaseTimeout بیشترین انتظار برای آزاد شدن یک اتصال.
const leaseTimeout = 5 * time.Second

// Send یک سفارش می‌فرستد. برای فراخوانی هم‌زمان امن است.
func (s *APISender) Send(attempt int) Result {
	if s.idle == nil {
		return Result{Accepted: false, Detail: "اتصال آماده نیست"}
	}
	var c *conn
	select {
	case c = <-s.idle:
	case <-time.After(leaseTimeout):
		return Result{Accepted: false, Detail: "هیچ اتصالی آزاد نشد"}
	}

	request := s.BuildRequest(s.price)
	result, err := s.trySend(c, request)
	if err != nil {
		// اتصال مرده بود؛ یک اتصال تازه و یک تلاش دیگر. بدنه هم از نو ساخته
		// می‌شود تا زمانِ داخل سفارش عقب نماند.
		c = s.replace(c)
		result, err = s.trySend(c, s.BuildRequest(s.price))
	}
	s.idle <- c
	if err != nil {
		return Result{Accepted: false, Detail: fmt.Sprintf("ارسال ناموفق: %v", err)}
	}
	return result
}

func (s *APISender) trySend(c *conn, request []byte) (Result, error) {
	c.net.SetDeadline(time.Now().Add(10 * time.Second))
	if _, err := c.net.Write(request); err != nil {
		return Result{}, err
	}
	resp, err := http.ReadResponse(c.reader, nil)
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
	return s.interpret(resp.StatusCode, string(body)), nil
}

func (s *APISender) interpret(status int, body string) Result {
	if status == 404 {
		return Result{Accepted: false, Detail: fmt.Sprintf(
			"HTTP 404 — مسیر ثبت سفارش (%s) روی سرور کارگزار وجود ندارد؛ "+
				"یک‌بار در ایزی‌تریدر سفارشی ثبت کنید تا مسیر واقعی یاد گرفته شود",
			s.targetURL())}
	}
	if status == 401 || status == 403 {
		return Result{Accepted: false, Detail: fmt.Sprintf(
			"HTTP %d — کارگزار درخواست را نپذیرفت؛ احتمالاً توکن منقضی شده: در پنجرهٔ "+
				"ایزی‌تریدر دوباره وارد شوید. %s", status, trim(body, 200)), Fatal: true}
	}

	// نشانهٔ دستی، اگر کاربر گذاشته باشد، حرف آخر را می‌زند.
	if marker := strings.TrimSpace(s.cfg.SuccessMarker); marker != "" {
		if strings.Contains(body, marker) {
			return Result{Accepted: true, Detail: fmt.Sprintf("سفارش پذیرفته شد (HTTP %d)", status)}
		}
		return Result{Accepted: false, Detail: fmt.Sprintf("%s (HTTP %d)",
			brokerMessage(body, "نشانهٔ موفقیت در پاسخ نبود"), status)}
	}

	// وگرنه خودِ پاسخ را می‌خوانیم: کارگزار معمولاً کد ۲۰۰ می‌دهد و نتیجه را
	// داخل بدنه می‌گوید. بدون این، یک «رد شد» به‌اشتباه «پذیرفته» حساب می‌شود.
	if accepted, message, ok := jsonVerdict(body); ok {
		if accepted {
			return Result{Accepted: true, Detail: fmt.Sprintf("سفارش پذیرفته شد (HTTP %d)", status)}
		}
		if message == "" {
			message = "کارگزار سفارش را نپذیرفت"
		}
		return Result{Accepted: false, Detail: fmt.Sprintf("%s (HTTP %d)", message, status)}
	}

	if status >= 200 && status < 300 {
		return Result{Accepted: true, Detail: fmt.Sprintf("سفارش پذیرفته شد (HTTP %d)", status)}
	}
	return Result{Accepted: false, Detail: fmt.Sprintf("HTTP %d: %s", status, trim(body, 400))}
}

var (
	successFieldRe = regexp.MustCompile(`(?i)^(issuccessful|issuccess|success|succeeded|isok|isdone)$`)
	messageFieldRe = regexp.MustCompile(`(?i)^(message|error|errormessage|errordescription|description|msg)$`)
)

// jsonVerdict نتیجه را از خود بدنهٔ پاسخ می‌خواند.
func jsonVerdict(body string) (accepted bool, message string, ok bool) {
	var parsed map[string]interface{}
	if json.Unmarshal([]byte(strings.TrimSpace(body)), &parsed) != nil {
		return false, "", false
	}
	for key, value := range parsed {
		if successFieldRe.MatchString(key) {
			if flag, isBool := value.(bool); isBool {
				accepted, ok = flag, true
			}
		}
		if messageFieldRe.MatchString(key) {
			if text, isString := value.(string); isString && strings.TrimSpace(text) != "" {
				message = text
			}
		}
	}
	return accepted, message, ok
}

// brokerMessage پیام خود کارگزار را از پاسخ بیرون می‌کشد.
func brokerMessage(body, fallback string) string {
	if _, message, ok := jsonVerdict(body); ok && message != "" {
		return message
	}
	if trimmed := trim(body, 200); trimmed != "" {
		return trimmed
	}
	return fallback
}

func (s *APISender) Close() {
	s.mu.Lock()
	all := s.all
	s.all = nil
	s.mu.Unlock()
	for _, c := range all {
		c.net.Close()
	}
	s.idle = nil
}

func trim(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}
