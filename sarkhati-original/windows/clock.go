package main

import (
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/http"
	"sort"
	"time"
)

// ntpUnixDelta فاصلهٔ مبدأ NTP (۱۹۰۰) تا مبدأ یونیکس (۱۹۷۰) بر حسب ثانیه.
const ntpUnixDelta = 2208988800

// Clock تخمین ساعت سرور است، لنگرانداخته روی ساعت یکنواخت (monotonic) ویندوز.
//
// هر محاسبه‌ای از روی time.Since(Anchor) انجام می‌شود، پس اگر ویندوز وسط کار
// ساعتش را با اینترنت همگام کند و بپرد، زمان‌بندی ما خراب نمی‌شود.
type Clock struct {
	ServerAtAnchor time.Time     `json:"-"`
	Anchor         time.Time     `json:"-"`
	Uncertainty    time.Duration `json:"-"`
	Source         string        `json:"source"`
	Samples        int           `json:"samples"`
}

// LocalClock ساعت دستگاه، بدون هیچ تصحیحی.
func LocalClock() Clock {
	now := time.Now()
	return Clock{ServerAtAnchor: now, Anchor: now, Source: "ساعت ویندوز"}
}

// Now زمان تخمینی سرور.
func (c Clock) Now() time.Time {
	return c.ServerAtAnchor.Add(time.Since(c.Anchor))
}

// Until فاصلهٔ تا یک لحظه روی ساعت سرور.
func (c Clock) Until(t time.Time) time.Duration {
	return t.Sub(c.Now())
}

// Fresh می‌گوید این ساعت از یک منبع بیرونی آمده و به‌اندازهٔ کافی تازه است
// که بشود بدون همگام‌سازی دوباره روی آن حساب کرد.
func (c Clock) Fresh() bool {
	return c.Samples > 0 && time.Since(c.Anchor) < 10*time.Minute
}

// OffsetMillis اختلاف ساعت ویندوز با سرور.
func (c Clock) OffsetMillis() float64 {
	return float64(c.Now().Sub(time.Now())) / float64(time.Millisecond)
}

func (c Clock) Describe() string {
	return fmt.Sprintf("%s | اختلاف %+.0f ms | عدم‌قطعیت ±%.1f ms | %d نمونه",
		c.Source, c.OffsetMillis(),
		float64(c.Uncertainty)/float64(time.Millisecond), c.Samples)
}

// SyncClock بهترین منبع در دسترس را انتخاب می‌کند.
//
// اول هدر Date خودِ کارگزار (چون مرجع پذیرش سفارش همان ساعت است)، بعد NTP.
func SyncClock(baseURL string, ntpServers []string, maxUncertainty time.Duration) Clock {
	var best *Clock
	if baseURL != "" {
		if c, err := SyncHTTPDate(baseURL, 40); err == nil {
			if c.Uncertainty <= maxUncertainty {
				return c
			}
			best = &c
		}
	}
	if c, err := SyncNTP(ntpServers, 4); err == nil {
		if best == nil || c.Uncertainty < best.Uncertainty {
			return c
		}
	}
	if best != nil {
		return *best
	}
	return LocalClock()
}

// SyncHTTPDate مرز ثانیهٔ سرور را با لبه‌یابی هدر Date پیدا می‌کند.
//
// هدر Date فقط دقت ثانیه دارد، ولی لحظه‌ای که مقدارش یک واحد می‌پرد دقیقاً
// مرز ثانیهٔ سرور است. با درخواست‌های پیاپی آن لحظه را محاصره می‌کنیم و هرچه
// بازهٔ محاصره کوچک‌تر شود، تخمین دقیق‌تر است.
func SyncHTTPDate(baseURL string, probes int) (Clock, error) {
	client := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			// پراکسی سیستم را رعایت می‌کنیم تا پشت شبکهٔ سازمانی هم کار کند.
			Proxy:               http.ProxyFromEnvironment,
			MaxIdleConnsPerHost: 2,
			DisableCompression:  true,
		},
	}
	defer client.CloseIdleConnections()

	var (
		prevSecond   time.Time
		prevReceived time.Time
		bestLower    time.Time
		bestUpper    time.Time
		bestSecond   time.Time
		found        bool
		samples      int
	)

	// بعضی سرورها و پراکسی‌ها متد HEAD را رد می‌کنند؛ در آن صورت با GET ادامه
	// می‌دهیم. هدر Date در هر دو حالت یکی است.
	method := http.MethodHead

	// تعداد نمونه به‌تنهایی کافی نیست: روی اتصال خیلی سریع (سرور نزدیک یا
	// شبکهٔ محلی) چهل درخواست در کمتر از یک ثانیه تمام می‌شود و هیچ مرز
	// ثانیه‌ای رخ نمی‌دهد. پس تا دیدن لبه — یا رسیدن به مهلت — ادامه می‌دهیم.
	deadline := time.Now().Add(3 * time.Second)
	maxProbes := probes * 10

	for i := 0; i < maxProbes && time.Now().Before(deadline); i++ {
		sent := time.Now()
		serverSecond, err := probeDate(client, baseURL, method)
		received := time.Now()
		if err != nil {
			if method == http.MethodHead {
				method = http.MethodGet
				continue // یک‌بار با GET دوباره امتحان کن
			}
			if samples == 0 && i > 4 {
				return Clock{}, err // سرور اصلاً جواب نمی‌دهد
			}
			continue
		}
		samples++
		if !prevSecond.IsZero() && serverSecond.After(prevSecond) {
			// لبه بین «رسیدن پاسخ قبلی» و «فرستادن این درخواست» بوده.
			if !found || sent.Sub(prevReceived) < bestUpper.Sub(bestLower) {
				bestLower, bestUpper, bestSecond = prevReceived, sent, serverSecond
				found = true
			}
		}
		prevSecond, prevReceived = serverSecond, received
		if found && bestUpper.Sub(bestLower) < 10*time.Millisecond {
			break // بهتر از ۱۰ میلی‌ثانیه؛ کافی است
		}
		// روی سرور خیلی نزدیک، بدون این مکث در ثانیه صدها درخواست می‌رفت.
		if elapsed := time.Since(sent); elapsed < 4*time.Millisecond {
			time.Sleep(4*time.Millisecond - elapsed)
		}
	}

	if !found {
		return Clock{}, fmt.Errorf("لبهٔ ثانیه در هدر Date پیدا نشد")
	}
	spread := bestUpper.Sub(bestLower)
	anchor := bestLower.Add(spread / 2)
	return Clock{
		ServerAtAnchor: bestSecond,
		Anchor:         anchor,
		Uncertainty:    spread / 2,
		Source:         "هدر Date کارگزار",
		Samples:        samples,
	}, nil
}

func probeDate(client *http.Client, url, method string) (time.Time, error) {
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		return time.Time{}, err
	}
	req.Header.Set("Cache-Control", "no-cache")
	if method == http.MethodGet {
		// بدنه را نمی‌خواهیم؛ فقط هدر Date مهم است.
		req.Header.Set("Range", "bytes=0-0")
	}
	resp, err := client.Do(req)
	if err != nil {
		return time.Time{}, err
	}
	io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	resp.Body.Close()
	if resp.StatusCode == http.StatusMethodNotAllowed || resp.StatusCode == http.StatusForbidden {
		return time.Time{}, fmt.Errorf("سرور متد %s را نمی‌پذیرد (HTTP %d)", method, resp.StatusCode)
	}
	raw := resp.Header.Get("Date")
	if raw == "" {
		return time.Time{}, fmt.Errorf("پاسخ سرور هدر Date ندارد")
	}
	return http.ParseTime(raw)
}

// SyncNTP نمونه‌های SNTP می‌گیرد و کم‌تأخیرترین را برمی‌گرداند.
func SyncNTP(servers []string, perServer int) (Clock, error) {
	type sample struct {
		offset time.Duration
		rtt    time.Duration
		anchor time.Time
	}
	var samples []sample

	for _, server := range servers {
		for i := 0; i < perServer; i++ {
			offset, rtt, anchor, err := ntpSample(server)
			if err != nil {
				break // این سرور جواب نمی‌دهد؛ سراغ بعدی
			}
			samples = append(samples, sample{offset, rtt, anchor})
		}
	}
	if len(samples) == 0 {
		return Clock{}, fmt.Errorf("هیچ سرور NTP پاسخ نداد")
	}
	// فیلتر کمینه‌تأخیر: نمونه‌ای با کمترین رفت‌وبرگشت کمترین خطا را دارد.
	sort.Slice(samples, func(i, j int) bool { return samples[i].rtt < samples[j].rtt })
	best := samples[0]
	return Clock{
		ServerAtAnchor: best.anchor.Add(best.offset),
		Anchor:         best.anchor,
		Uncertainty:    best.rtt / 2,
		Source:         "NTP",
		Samples:        len(samples),
	}, nil
}

func ntpSample(server string) (offset, rtt time.Duration, anchor time.Time, err error) {
	conn, err := net.DialTimeout("udp", net.JoinHostPort(server, "123"), 2*time.Second)
	if err != nil {
		return 0, 0, time.Time{}, err
	}
	defer conn.Close()
	if err = conn.SetDeadline(time.Now().Add(2 * time.Second)); err != nil {
		return 0, 0, time.Time{}, err
	}

	packet := make([]byte, 48)
	packet[0] = 0x1b // LI=0, VN=3, Mode=3 (client)

	t0 := time.Now()
	if _, err = conn.Write(packet); err != nil {
		return 0, 0, time.Time{}, err
	}
	if _, err = conn.Read(packet); err != nil {
		return 0, 0, time.Time{}, err
	}
	t3 := time.Now()

	t1 := ntpTimestamp(packet[32:40]) // receive
	t2 := ntpTimestamp(packet[40:48]) // transmit
	rtt = t3.Sub(t0) - t2.Sub(t1)
	if rtt < 0 {
		rtt = 0
	}
	offset = (t1.Sub(t0) + t2.Sub(t3)) / 2
	anchor = t0.Add(t3.Sub(t0) / 2)
	return offset, rtt, anchor, nil
}

func ntpTimestamp(b []byte) time.Time {
	seconds := binary.BigEndian.Uint32(b[0:4])
	fraction := binary.BigEndian.Uint32(b[4:8])
	nanos := (int64(fraction) * 1e9) >> 32
	return time.Unix(int64(seconds)-ntpUnixDelta, nanos)
}
