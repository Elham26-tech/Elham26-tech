package main

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"time"
)

// ساعت خود کارگزار: دقیق‌ترین مرجع ممکن برای سرخطی.
//
// همگام‌سازی با NTP یا هدر Date، ساعت را به وقت جهانی نزدیک می‌کند؛ ولی آنچه
// سفارش شما با آن سنجیده می‌شود ساعت سرور کارگزار است. ایزی‌تریدر خودش
// endpointای دارد که همین ساعت را برمی‌گرداند، و اگر دیده باشیمش از همان
// استفاده می‌کنیم.

var (
	// شمارهٔ زمانِ داخل مسیر (میلی‌ثانیهٔ یونیکس، ۱۳ رقمی) را جایگزین می‌کنیم.
	pathTimestampRe = regexp.MustCompile(`\b\d{13}\b`)
	serverTimeKeyRe = regexp.MustCompile(`(?i)(servertimestamp|server_?time|timestamp|now|epoch)`)
)

// BrokerClock ساعت کارگزار را چند بار می‌خواند و دقیق‌ترین نمونه را برمی‌گرداند.
func (c *Capturer) BrokerClock(samples int) (Clock, error) {
	request := c.ServerTimeRequest()
	if request == nil {
		return Clock{}, fmt.Errorf("مسیر ساعت کارگزار هنوز دیده نشده")
	}
	if samples < 1 {
		samples = 3
	}

	type reading struct {
		offset time.Duration
		rtt    time.Duration
		anchor time.Time
	}
	var readings []reading
	var lastErr error

	for i := 0; i < samples; i++ {
		now := time.Now()
		target := pathTimestampRe.ReplaceAllString(request.URL,
			strconv.FormatInt(now.UnixMilli(), 10))

		sent := time.Now()
		raw, err := c.fetchJSONWithHeaders(request.Method, target, request.PostData,
			replayableHeaders(request.Headers))
		received := time.Now()
		if err != nil {
			lastErr = err
			continue
		}
		serverMillis, ok := serverTimestampOf(raw)
		if !ok {
			lastErr = fmt.Errorf("پاسخ ساعت کارگزار قابل خواندن نبود")
			continue
		}
		rtt := received.Sub(sent)
		// فرض متعارف: نصف رفت‌وبرگشت تا رسیدن درخواست، نصف تا برگشت پاسخ.
		middle := sent.Add(rtt / 2)
		readings = append(readings, reading{
			offset: time.UnixMilli(serverMillis).Sub(middle),
			rtt:    rtt,
			anchor: middle,
		})
	}

	if len(readings) == 0 {
		if lastErr == nil {
			lastErr = fmt.Errorf("ساعت کارگزار خوانده نشد")
		}
		return Clock{}, lastErr
	}
	// کم‌تأخیرترین نمونه کمترین خطا را دارد.
	sort.Slice(readings, func(i, j int) bool { return readings[i].rtt < readings[j].rtt })
	best := readings[0]
	return Clock{
		ServerAtAnchor: best.anchor.Add(best.offset),
		Anchor:         best.anchor,
		Uncertainty:    best.rtt / 2,
		Source:         "ساعت کارگزار",
		Samples:        len(readings),
	}, nil
}

// serverTimestampOf زمان سرور را از پاسخ بیرون می‌کشد.
//
// شکل پاسخ بین کارگزاری‌ها فرق دارد، پس به‌جای نام دقیق کلید، دنبال عددی
// می‌گردیم که مثل میلی‌ثانیهٔ یونیکس باشد.
func serverTimestampOf(raw json.RawMessage) (int64, bool) {
	fields := numbersByKey(raw)

	best := int64(0)
	for key, value := range fields {
		millis := int64(value)
		if !serverTimeKeyRe.MatchString(key) {
			continue
		}
		if plausibleEpochMillis(millis) && millis > best {
			best = millis
		}
	}
	if best > 0 {
		return best, true
	}
	// کلید ناشناخته؛ هر عددی که در بازهٔ منطقی باشد.
	for _, value := range fields {
		if millis := int64(value); plausibleEpochMillis(millis) {
			return millis, true
		}
	}
	return 0, false
}

// plausibleEpochMillis عدد را با بازهٔ منطقی زمان حال می‌سنجد (۲۰۲۰ تا ۲۰۵۰).
func plausibleEpochMillis(millis int64) bool {
	return millis > 1_577_836_800_000 && millis < 2_524_608_000_000
}
