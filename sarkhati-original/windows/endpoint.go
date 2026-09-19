package main

import (
	"encoding/json"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// Endpoint یک درخواست یادگرفته‌شده به‌همراه اینکه کدام پارامترش متغیر است.
//
// دانستن نامِ پارامتر مهم است: برای تکرار همان درخواست با نماد یا عبارت
// دیگر، باید دقیقاً همان پارامتر عوض شود نه چیزی که حدس زده‌ایم.
type Endpoint struct {
	Method   string `json:"method"`
	URL      string `json:"url"`
	Param    string `json:"param"`     // نام پارامتر متغیر (در query یا بدنهٔ JSON)
	InBody   bool   `json:"in_body"`   // پارامتر در بدنهٔ JSON است، نه در نشانی
	PostData string `json:"post_data"` // بدنهٔ اصلی، برای درخواست‌های POST
	Sample   string `json:"sample"`    // مقداری که هنگام یادگیری در آن پارامتر بود

	// Contains یعنی مقدار متغیر *داخل* متن آن فیلد است، نه کل آن — مثل کد
	// نماد داخل متن یک پرس‌وجوی GraphQL.
	Contains bool `json:"contains,omitempty"`

	// هدرهای همان درخواست واقعی. بعضی کارگزاری‌ها بدون هدرهای اختصاصی
	// (Origin، Referer، هدرهای x-*) درخواست را رد می‌کنند.
	Headers map[string]string `json:"headers,omitempty"`
}

// With همان درخواست را با مقدار تازه می‌سازد.
func (e Endpoint) With(value string) (string, string, bool) {
	if e.Contains && e.InBody {
		body, ok := replaceInJSONField(e.PostData, e.Param, e.Sample, value)
		return e.URL, body, ok
	}
	if e.InBody {
		body, ok := replaceJSONField(e.PostData, e.Param, value)
		return e.URL, body, ok
	}
	parsed, err := url.Parse(e.URL)
	if err != nil {
		return "", "", false
	}
	query := parsed.Query()
	if _, exists := query[e.Param]; !exists {
		return "", "", false
	}
	query.Set(e.Param, value)
	parsed.RawQuery = query.Encode()
	return parsed.String(), e.PostData, true
}

// replaceInJSONField فقط همان تکهٔ متن را داخل مقدار فیلد عوض می‌کند.
func replaceInJSONField(body, field, old, value string) (string, bool) {
	if old == "" {
		return "", false
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(body), &parsed); err != nil {
		return "", false
	}
	text, ok := parsed[field].(string)
	if !ok || !strings.Contains(text, old) {
		return "", false
	}
	parsed[field] = strings.ReplaceAll(text, old, value)
	encoded, err := json.Marshal(parsed)
	if err != nil {
		return "", false
	}
	return string(encoded), true
}

func replaceJSONField(body, field, value string) (string, bool) {
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(body), &parsed); err != nil {
		return "", false
	}
	if _, exists := parsed[field]; !exists {
		return "", false
	}
	parsed[field] = value
	encoded, err := json.Marshal(parsed)
	if err != nil {
		return "", false
	}
	return string(encoded), true
}

var isinValueRe = regexp.MustCompile(`^IR[A-Z0-9]{10}$`)

// looksLikeSearchTerm می‌گوید یک مقدار، عبارتِ جست‌وجوی تایپ‌شده به نظر می‌رسد.
//
// عبارت جست‌وجو کوتاه است، حرف دارد، عدد خالص نیست و ISIN هم نیست.
func looksLikeSearchTerm(value string) bool {
	trimmed := strings.TrimSpace(value)
	runes := []rune(trimmed)
	if len(runes) == 0 || len(runes) > 12 {
		return false
	}
	if isinValueRe.MatchString(trimmed) {
		return false
	}
	if _, err := strconv.ParseFloat(trimmed, 64); err == nil {
		return false
	}
	if strings.EqualFold(trimmed, "true") || strings.EqualFold(trimmed, "false") {
		return false
	}
	for _, r := range runes {
		if unicode.IsLetter(r) {
			return true
		}
	}
	return false
}

// findTermParam پارامتری را پیدا می‌کند که عبارت جست‌وجو در آن است.
func findTermParam(rawURL string) (string, string, bool) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", "", false
	}
	query := parsed.Query()
	// اول پارامترهایی با نام آشنا، بعد هر پارامتری که شبیه عبارت جست‌وجوست.
	for name, values := range query {
		if searchParamNameRe.MatchString(name) && len(values) > 0 && looksLikeSearchTerm(values[0]) {
			return name, values[0], true
		}
	}
	for name, values := range query {
		if len(values) > 0 && looksLikeSearchTerm(values[0]) {
			return name, values[0], true
		}
	}
	return "", "", false
}

// findISINParam پارامتری را پیدا می‌کند که کد ISIN در آن است.
func findISINParam(rawURL string) (string, string, bool) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", "", false
	}
	for name, values := range parsed.Query() {
		if len(values) > 0 && isinValueRe.MatchString(strings.TrimSpace(values[0])) {
			return name, values[0], true
		}
	}
	return "", "", false
}

// findTermField همان کار را برای بدنهٔ JSON انجام می‌دهد.
func findTermField(body string, isinMode bool) (string, string, bool) {
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(body), &parsed); err != nil {
		return "", "", false
	}
	for name, value := range parsed {
		text, isString := value.(string)
		if !isString {
			continue
		}
		if isinMode && isinValueRe.MatchString(strings.TrimSpace(text)) {
			return name, text, true
		}
		if !isinMode && looksLikeSearchTerm(text) {
			return name, text, true
		}
	}
	return "", "", false
}

// replayableHeaders هدرهایی را نگه می‌دارد که تکرارشان معنا دارد.
//
// هدرهای وابسته به اتصال و طول بدنه را خودمان می‌سازیم؛ بقیه — از جمله
// Origin و Referer و هدرهای اختصاصی کارگزار — باید عیناً تکرار شوند.
func replayableHeaders(headers map[string]string) map[string]string {
	if len(headers) == 0 {
		return nil
	}
	out := map[string]string{}
	for name, value := range headers {
		switch strings.ToLower(name) {
		case "host", "content-length", "connection", "accept-encoding",
			"authorization", "content-type", ":authority", ":method", ":path", ":scheme":
			continue
		}
		if strings.HasPrefix(name, ":") || value == "" {
			continue
		}
		out[name] = value
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// findISINInsideField فیلدی را پیدا می‌کند که کد نماد جایی داخل متنش است.
func findISINInsideField(body string) (string, string, bool) {
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(body), &parsed); err != nil {
		return "", "", false
	}
	for name, value := range parsed {
		text, isString := value.(string)
		if !isString {
			continue
		}
		if found := isinRe.FindString(text); found != "" {
			return name, found, true
		}
	}
	return "", "", false
}

var searchParamNameRe = regexp.MustCompile(
	`(?i)^(q|term|query|search|searchterm|keyword|key|value|text|name|symbol|filter|phrase)$`)

// buildEndpoint از یک درخواست دیده‌شده، یک نقطهٔ قابل تکرار می‌سازد.
func buildEndpoint(method, rawURL, postData string, isinMode bool) (Endpoint, bool) {
	return buildEndpointWithHeaders(method, rawURL, postData, nil, isinMode)
}

func buildEndpointWithHeaders(method, rawURL, postData string, headers map[string]string,
	isinMode bool) (Endpoint, bool) {
	endpoint := Endpoint{Method: method, URL: rawURL, PostData: postData,
		Headers: replayableHeaders(headers)}

	if isinMode {
		if name, value, ok := findISINParam(rawURL); ok {
			endpoint.Param, endpoint.Sample = name, value
			return endpoint, true
		}
		if name, value, ok := findTermField(postData, true); ok {
			endpoint.Param, endpoint.Sample, endpoint.InBody = name, value, true
			return endpoint, true
		}
		// کد نماد داخل متن یک فیلد (مثل پرس‌وجوی GraphQL).
		if name, sample, ok := findISINInsideField(postData); ok {
			endpoint.Param, endpoint.Sample = name, sample
			endpoint.InBody, endpoint.Contains = true, true
			return endpoint, true
		}
		// بعضی مسیرها کد را داخل خودِ مسیر دارند، نه در پارامتر.
		if isinRe.MatchString(rawURL) {
			endpoint.Param = ""
			return endpoint, true
		}
		return Endpoint{}, false
	}

	if name, value, ok := findTermParam(rawURL); ok {
		endpoint.Param, endpoint.Sample = name, value
		return endpoint, true
	}
	if name, value, ok := findTermField(postData, false); ok {
		endpoint.Param, endpoint.Sample, endpoint.InBody = name, value, true
		return endpoint, true
	}
	return Endpoint{}, false
}

func parseNumber(text string) (float64, error) {
	return strconv.ParseFloat(strings.TrimSpace(text), 64)
}
