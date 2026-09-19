package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// شکل واقعی پاسخ ساعت سرور ایزی‌تریدر.
func TestServerTimestampFromMofidShape(t *testing.T) {
	millis, ok := serverTimestampOf(json.RawMessage(`{"diff":3193,"serverTimestamp":1789307140823}`))
	if !ok || millis != 1789307140823 {
		t.Fatalf("زمان سرور: %d (%v)", millis, ok)
	}
}

func TestServerTimestampIgnoresSmallNumbers(t *testing.T) {
	// diff تنهایی نباید به‌جای زمان گرفته شود.
	if _, ok := serverTimestampOf(json.RawMessage(`{"diff":3193,"status":200}`)); ok {
		t.Error("عدد کوچک نباید زمان یونیکس حساب شود")
	}
}

func TestBrokerClockUsesServerTime(t *testing.T) {
	// سروری که ساعتش دقیقاً ۵ ثانیه از ما جلوتر است.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		millis := time.Now().Add(5 * time.Second).UnixMilli()
		w.Write([]byte(`{"diff":0,"serverTimestamp":` + itoa64(millis) + `}`))
	}))
	defer server.Close()

	c := NewCapturer()
	c.record("r1", "GET", server.URL+"/easy/api/account/server-time/1789330938662",
		map[string]string{"authorization": "Bearer a.b.c"}, "")

	if !c.Status().CanBrokerTime {
		t.Fatal("مسیر ساعت کارگزار تشخیص داده نشد")
	}
	clock, err := c.BrokerClock(3)
	if err != nil {
		t.Fatal(err)
	}
	if offset := clock.OffsetMillis(); offset < 4500 || offset > 5500 {
		t.Errorf("اختلاف ساعت %.0f ms، انتظار حدود ۵۰۰۰", offset)
	}
	if !strings.Contains(clock.Source, "کارگزار") {
		t.Errorf("منبع ساعت: %s", clock.Source)
	}
}

func TestBrokerClockReplacesTimestampInPath(t *testing.T) {
	var seen string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r.URL.Path
		w.Write([]byte(`{"serverTimestamp":` + itoa64(time.Now().UnixMilli()) + `}`))
	}))
	defer server.Close()

	c := NewCapturer()
	c.record("r1", "GET", server.URL+"/easy/api/account/server-time/1700000000000",
		map[string]string{"authorization": "Bearer a.b.c"}, "")
	if _, err := c.BrokerClock(1); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(seen, "1700000000000") {
		t.Errorf("زمانِ داخل مسیر تازه‌سازی نشد: %s", seen)
	}
}
