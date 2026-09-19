package main

import (
	"strings"
	"testing"
)

const chromeCurl = `curl 'https://api.emofid.com/easy/api/OmsOrder/Post' \
  -H 'authorization: Bearer eyJhbGciOi.PAYLOAD.SIG' \
  -H 'content-type: application/json' \
  --data-raw '{"isin":"IRO1FOLD0001","price":5592,"quantity":1000,"side":1,"validityType":1}' \
  --compressed`

func TestParseCurlFromChrome(t *testing.T) {
	parsed, err := ParseCurl(chromeCurl)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Method != "POST" {
		t.Errorf("متد: %s", parsed.Method)
	}
	if parsed.URL != "https://api.emofid.com/easy/api/OmsOrder/Post" {
		t.Errorf("نشانی: %s", parsed.URL)
	}
	if parsed.Token() != "eyJhbGciOi.PAYLOAD.SIG" {
		t.Errorf("توکن: %s", parsed.Token())
	}
	if !strings.Contains(parsed.Body, `"quantity":1000`) {
		t.Errorf("بدنه: %s", parsed.Body)
	}
}

func TestParseCurlWithUnicodeQuoting(t *testing.T) {
	// کروم برای متن فارسی شکل $'...' می‌سازد.
	parsed, err := ParseCurl(`curl $'https://api.example.com/s?q=فول' -H 'accept: application/json'`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(parsed.URL, "https://api.example.com/s?q=") {
		t.Errorf("نشانی: %s", parsed.URL)
	}
}

func TestParseCurlRejectsGarbage(t *testing.T) {
	if _, err := ParseCurl("just some text"); err == nil {
		t.Error("متن بی‌ربط باید رد شود")
	}
	if _, err := ParseCurl("curl -H 'a: b'"); err == nil {
		t.Error("بدون نشانی باید رد شود")
	}
}

func TestImportCurlDetectsKind(t *testing.T) {
	c := NewCapturer()
	kind, err := c.ImportCurl(chromeCurl, "")
	if err != nil || kind != "سفارش" {
		t.Fatalf("نوع: %s خطا=%v", kind, err)
	}
	status := c.Status()
	if !status.CanOrder || status.OrderPath != "/easy/api/OmsOrder/Post" {
		t.Errorf("سفارش ثبت نشد: %+v", status)
	}
	if !status.LoggedIn {
		t.Error("توکن از متن cURL برداشته نشد")
	}

	if _, err := c.ImportCurl(`curl 'https://api.example.com/x?zz=فول'`, ""); err != nil {
		t.Fatalf("جست‌وجو وارد نشد: %v", err)
	}
	if !c.Status().CanSearch {
		t.Error("جست‌وجو ثبت نشد")
	}

	if _, err := c.ImportCurl(`curl 'https://api.example.com/y?code=IRO1FOLD0001'`, ""); err != nil {
		t.Fatalf("اطلاعات نماد وارد نشد: %v", err)
	}
	if !c.Status().CanQuote {
		t.Error("اطلاعات نماد ثبت نشد")
	}
}
