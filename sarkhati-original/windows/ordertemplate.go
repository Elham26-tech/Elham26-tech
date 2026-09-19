package main

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
)

// ساخت قالب سفارش از روی بدنهٔ یک سفارش واقعی.
//
// بدنهٔ سفارش کارگزاری‌ها تودرتوست و فیلدهایی دارد که باید در هر ارسال از نو
// ساخته شوند (زمان، ارزش کل). پس نه می‌شود فقط سطح اول را نگاه کرد و نه
// می‌شود بدنه را عیناً تکرار کرد.

var (
	priceKeyRe    = regexp.MustCompile(`(?i)^(price|orderprice|pricelimit)$`)
	quantityKeyRe = regexp.MustCompile(`(?i)^(quantity|volume|count|ordervolume|orderquantity)$`)
	sideKeyRe     = regexp.MustCompile(`(?i)^(side|orderside|buysell|ordertype|isbuy)$`)
	isinKeyRe     = regexp.MustCompile(`(?i)^(isin|instrumentisin|symbolisin|instrumentid|symbolid)$`)
	symbolKeyName = regexp.MustCompile(`(?i)^(symbolname|symboltitle|instrumentname|name)$`)
	valueKeyRe    = regexp.MustCompile(`(?i)^(totalvalue|ordervalue|totalprice|amount)$`)
	dateKeyRe     = regexp.MustCompile(`(?i)(createdatetime|datetime|orderdate|requestdate|senddate|^date$|^time$)`)
	commissionRe  = regexp.MustCompile(`(?i)^(commission|fee|feerate)$`)
)

// looksLikeOrderBody می‌گوید این بدنه، ثبت سفارش است یا نه.
//
// جست‌وجو بازگشتی است: بدنهٔ ایزی‌تریدر شکل {"order":{...}} دارد و اگر فقط
// سطح اول را نگاه کنیم، سفارش واقعی هیچ‌وقت شناخته نمی‌شود.
func looksLikeOrderBody(postData string) bool {
	var decoded interface{}
	if json.Unmarshal([]byte(strings.TrimSpace(postData)), &decoded) != nil {
		return false
	}
	return findOrderObject(decoded) != nil
}

// findOrderObject تودرتوترین شیئی را می‌دهد که هم قیمت دارد هم حجم.
func findOrderObject(value interface{}) map[string]interface{} {
	switch typed := value.(type) {
	case map[string]interface{}:
		hasPrice, hasQuantity := false, false
		for key := range typed {
			if priceKeyRe.MatchString(key) {
				hasPrice = true
			}
			if quantityKeyRe.MatchString(key) {
				hasQuantity = true
			}
		}
		if hasPrice && hasQuantity {
			return typed
		}
		for _, child := range typed {
			if found := findOrderObject(child); found != nil {
				return found
			}
		}
	case []interface{}:
		for _, child := range typed {
			if found := findOrderObject(child); found != nil {
				return found
			}
		}
	}
	return nil
}

// OrderShape چیزهایی که از سفارش واقعی یاد گرفته‌ایم و در ارسال لازم‌اند.
type OrderShape struct {
	Template   string  `json:"template"`
	SideSample string  `json:"side_sample"` // مقدار سمت در همان سفارش واقعی
	DateSample string  `json:"date_sample"` // شکل تاریخِ همان سفارش
	Commission float64 `json:"commission"`  // کارمزد، برای محاسبهٔ ارزش کل
}

// BuildOrderShape بدنهٔ سفارش واقعی را به قالب و اجزای لازم تبدیل می‌کند.
func BuildOrderShape(postData string) (OrderShape, bool) {
	trimmed := strings.TrimSpace(postData)
	var decoded interface{}
	if json.Unmarshal([]byte(trimmed), &decoded) != nil {
		return OrderShape{}, false
	}
	order := findOrderObject(decoded)
	if order == nil {
		return OrderShape{}, false
	}

	shape := OrderShape{}
	for key, value := range order {
		switch {
		case sideKeyRe.MatchString(key):
			if raw, err := json.Marshal(value); err == nil {
				shape.SideSample = strings.Trim(string(raw), `"`)
			}
		case dateKeyRe.MatchString(key):
			if text, ok := value.(string); ok {
				shape.DateSample = text
			}
		case commissionRe.MatchString(key):
			if number, ok := value.(float64); ok {
				shape.Commission = number
			}
		}
	}
	shape.Template = encodeTemplate(decoded)
	return shape, true
}

// encodeTemplate ساختار را همان‌طور که هست بازمی‌نویسد و فقط مقادیر متغیر را
// با جای‌نگهدار عوض می‌کند. هر فیلد ناشناخته دست‌نخورده می‌ماند، چون تغییرش
// یعنی رد شدن سفارش.
func encodeTemplate(value interface{}) string {
	switch typed := value.(type) {
	case map[string]interface{}:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)

		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			encodedKey, _ := json.Marshal(key)
			parts = append(parts, fmt.Sprintf("%s:%s", encodedKey, templateValue(key, typed[key])))
		}
		return "{" + strings.Join(parts, ",") + "}"
	case []interface{}:
		parts := make([]string, 0, len(typed))
		for _, child := range typed {
			parts = append(parts, encodeTemplate(child))
		}
		return "[" + strings.Join(parts, ",") + "]"
	default:
		raw, err := json.Marshal(value)
		if err != nil {
			return "null"
		}
		return string(raw)
	}
}

func templateValue(key string, value interface{}) string {
	_, isString := value.(string)
	quote := func(placeholder string) string {
		if isString {
			return `"` + placeholder + `"`
		}
		return placeholder
	}
	switch {
	case priceKeyRe.MatchString(key):
		return quote("{price}")
	case quantityKeyRe.MatchString(key):
		return quote("{quantity}")
	case sideKeyRe.MatchString(key):
		return quote("{side}")
	case isinKeyRe.MatchString(key):
		return quote("{isin}")
	case symbolKeyName.MatchString(key) && isString:
		return `"{symbol}"`
	case valueKeyRe.MatchString(key):
		return quote("{value}")
	case dateKeyRe.MatchString(key) && isString:
		return `"{now}"`
	}
	return encodeTemplate(value)
}

// جای‌نگهدارهایی که در قالب ممکن است بیایند.
var jsLocaleDateRe = regexp.MustCompile(`^\d{1,2}/\d{1,2}/\d{4},\s+\d{1,2}:\d{2}:\d{2}\s*(AM|PM)$`)

// formatLikeSample زمان تازه را به همان شکلی می‌نویسد که کارگزار فرستاده بود.
func formatLikeSample(sample string, now time.Time) string {
	trimmed := strings.TrimSpace(sample)
	switch {
	case trimmed == "":
		return ""
	case jsLocaleDateRe.MatchString(trimmed):
		// شکلی که مرورگر با toLocaleString('en-US') می‌سازد.
		return now.Format("1/2/2006, 3:04:05 PM")
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05",
		"2006-01-02 15:04:05", "2006/01/02 15:04:05"} {
		if _, err := time.Parse(layout, trimmed); err == nil {
			return now.Format(layout)
		}
	}
	// شکلش را نشناختیم؛ همان مقدار اصلی امن‌تر از حدس زدن است.
	return sample
}

// orderTotalValue ارزش کل سفارش با احتساب کارمزد.
func orderTotalValue(price, quantity int64, commission float64) int64 {
	total := float64(price) * float64(quantity)
	if commission > 0 {
		total *= 1 + commission
	}
	return int64(math.Round(total))
}
