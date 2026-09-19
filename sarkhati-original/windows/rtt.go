package main

import (
	"net/http"
	"sort"
	"time"
)

// MeasureRTT زمان رفت‌وبرگشت تا کارگزار را چند بار می‌سنجد (مرتب‌شده).
func MeasureRTT(baseURL string, probes int) []time.Duration {
	if baseURL == "" {
		return nil
	}
	client := &http.Client{Timeout: 5 * time.Second}
	defer client.CloseIdleConnections()

	var samples []time.Duration
	for i := 0; i < probes; i++ {
		req, err := http.NewRequest(http.MethodHead, baseURL, nil)
		if err != nil {
			return nil
		}
		started := time.Now()
		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		resp.Body.Close()
		samples = append(samples, time.Since(started))
	}
	sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
	return samples
}
