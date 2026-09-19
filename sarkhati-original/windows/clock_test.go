package main

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// سرور محلی تقریباً بدون تأخیر جواب می‌دهد؛ این همان حالتی است که قبلاً
// همگام‌سازی در آن شکست می‌خورد، چون همهٔ نمونه‌ها داخل یک ثانیه تمام می‌شدند.
func TestSyncHTTPDateFindsEdgeOnFastServer(t *testing.T) {
	var hits int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&hits, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	started := time.Now()
	clock, err := SyncHTTPDate(server.URL, 40)
	if err != nil {
		t.Fatalf("لبهٔ ثانیه پیدا نشد: %v", err)
	}
	if clock.Uncertainty > 40*time.Millisecond {
		t.Errorf("عدم‌قطعیت %v بیش از حد است", clock.Uncertainty)
	}
	// ساعت سرور همین ماشین است، پس اختلاف باید نزدیک صفر باشد.
	if offset := clock.OffsetMillis(); offset < -1200 || offset > 1200 {
		t.Errorf("اختلاف ساعت %.0f ms منطقی نیست", offset)
	}
	if elapsed := time.Since(started); elapsed > 3500*time.Millisecond {
		t.Errorf("همگام‌سازی %v طول کشید", elapsed)
	}
	if count := atomic.LoadInt64(&hits); count > 400 {
		t.Errorf("%d درخواست برای یک همگام‌سازی زیادی است", count)
	}
}

func TestSyncHTTPDateFailsOnUnreachableHost(t *testing.T) {
	if _, err := SyncHTTPDate("http://127.0.0.1:9/", 6); err == nil {
		t.Error("میزبان در دسترس نیست؛ باید خطا بدهد")
	}
}
