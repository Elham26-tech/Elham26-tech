package main

import (
	"fmt"
	"net/url"
	"strings"
)

// وارد کردن از cURL: راه پشتیبان وقتی تشخیص خودکار به هر دلیلی جواب نداد.
//
// در تب Network مرورگر، راست‌کلیک روی درخواست ← Copy ← Copy as cURL. همان متن
// را اینجا می‌چسبانید و برنامه نشانی، هدرها (شامل توکن) و بدنه را درمی‌آورد.

// CurlRequest چیزی که از متن cURL بیرون کشیده شده.
type CurlRequest struct {
	Method  string
	URL     string
	Headers map[string]string
	Body    string
}

// ParseCurl یک فرمان cURL را می‌شکافد.
func ParseCurl(text string) (CurlRequest, error) {
	tokens := shellSplit(text)
	if len(tokens) == 0 || !strings.HasPrefix(strings.ToLower(tokens[0]), "curl") {
		return CurlRequest{}, fmt.Errorf("متن با curl شروع نمی‌شود")
	}

	out := CurlRequest{Headers: map[string]string{}}
	for i := 1; i < len(tokens); i++ {
		token := tokens[i]
		next := func() string {
			if i+1 < len(tokens) {
				i++
				return tokens[i]
			}
			return ""
		}
		switch {
		case token == "-H" || token == "--header":
			name, value, found := strings.Cut(next(), ":")
			if found {
				out.Headers[strings.TrimSpace(name)] = strings.TrimSpace(value)
			}
		case token == "-X" || token == "--request":
			out.Method = strings.ToUpper(next())
		case token == "-d" || token == "--data" || token == "--data-raw" ||
			token == "--data-binary" || token == "--data-ascii":
			out.Body = next()
		case strings.HasPrefix(token, "--data-raw="):
			out.Body = strings.TrimPrefix(token, "--data-raw=")
		case strings.HasPrefix(token, "-"):
			// پرچم‌های بی‌ربط (مثل --compressed یا -b) نادیده گرفته می‌شوند.
			continue
		default:
			if out.URL == "" && strings.HasPrefix(token, "http") {
				out.URL = token
			}
		}
	}

	if out.URL == "" {
		return CurlRequest{}, fmt.Errorf("نشانی در متن پیدا نشد")
	}
	if _, err := url.Parse(out.URL); err != nil {
		return CurlRequest{}, fmt.Errorf("نشانی نامعتبر است")
	}
	if out.Method == "" {
		if out.Body != "" {
			out.Method = "POST"
		} else {
			out.Method = "GET"
		}
	}
	return out, nil
}

// Token توکن Bearer را از هدرها درمی‌آورد.
func (c CurlRequest) Token() string {
	for name, value := range c.Headers {
		if strings.EqualFold(name, "authorization") {
			return strings.TrimSpace(strings.TrimPrefix(
				strings.TrimPrefix(value, "Bearer"), "bearer"))
		}
	}
	return ""
}

// shellSplit متن را مثل پوسته به توکن می‌شکند: گیومهٔ تکی، دوتایی و \ را می‌فهمد.
func shellSplit(text string) []string {
	var tokens []string
	var current strings.Builder
	inSingle, inDouble, started := false, false, false

	runes := []rune(strings.TrimSpace(text))
	for i := 0; i < len(runes); i++ {
		r := runes[i]
		switch {
		case inSingle:
			if r == '\'' {
				inSingle = false
			} else {
				current.WriteRune(r)
			}
		case inDouble:
			if r == '"' {
				inDouble = false
			} else if r == '\\' && i+1 < len(runes) {
				i++
				current.WriteRune(runes[i])
			} else {
				current.WriteRune(r)
			}
		case r == '\'':
			inSingle, started = true, true
		case r == '"':
			inDouble, started = true, true
		case r == '\\':
			// ادامهٔ خط در متن چندخطی، یا کاراکتر فرار
			if i+1 < len(runes) && (runes[i+1] == '\n' || runes[i+1] == '\r') {
				i++
				continue
			}
			if i+1 < len(runes) {
				i++
				current.WriteRune(runes[i])
				started = true
			}
		case r == ' ' || r == '\t' || r == '\n' || r == '\r':
			if current.Len() > 0 || started {
				tokens = append(tokens, current.String())
				current.Reset()
				started = false
			}
		case r == '$' && i+1 < len(runes) && runes[i+1] == '\'':
			// شکل $'...' که کروم برای متن یونیکد می‌سازد
			i++
			inSingle, started = true, true
		default:
			current.WriteRune(r)
			started = true
		}
	}
	if current.Len() > 0 || started {
		tokens = append(tokens, current.String())
	}
	return tokens
}

// ImportCurl یک درخواست چسبانده‌شده را به‌عنوان سفارش/جست‌وجو/اطلاعات نماد ثبت می‌کند.
//
// نوعش را خودش تشخیص می‌دهد مگر اینکه kind داده شود.
func (c *Capturer) ImportCurl(text, kind string) (string, error) {
	parsed, err := ParseCurl(text)
	if err != nil {
		return "", err
	}
	target, urlErr := url.Parse(parsed.URL)
	if urlErr != nil {
		return "", urlErr
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if token := parsed.Token(); token != "" {
		c.token = token
		c.apiBase = target.Scheme + "://" + target.Host
	}

	if kind == "" {
		switch {
		case looksLikeOrderBody(parsed.Body):
			kind = "order"
		case func() bool { _, _, ok := findISINParam(parsed.URL); return ok }():
			kind = "instrument"
		default:
			kind = "search"
		}
	}

	entry := CapturedRequest{
		Method: parsed.Method, URL: parsed.URL, Path: target.Path,
		PostData: parsed.Body, Kind: kind,
	}
	switch kind {
	case "order":
		if parsed.Body == "" {
			return "", fmt.Errorf("این درخواست بدنه ندارد؛ درخواست ثبت سفارش را کپی کنید")
		}
		c.order = &entry
		return "سفارش", nil
	case "search", "instrument":
		endpoint, ok := buildEndpoint(parsed.Method, parsed.URL, parsed.Body, kind == "instrument")
		if !ok {
			if kind == "instrument" {
				return "", fmt.Errorf("در این درخواست جای کد ISIN پیدا نشد")
			}
			return "", fmt.Errorf("در این درخواست جای عبارت جست‌وجو پیدا نشد")
		}
		c.requests = append(c.requests, entry)
		if kind == "search" {
			c.search = &endpoint
			return "جست‌وجو", nil
		}
		c.instrument = &endpoint
		return "اطلاعات نماد", nil
	}
	return "", fmt.Errorf("نوع نامعتبر: %s", kind)
}
