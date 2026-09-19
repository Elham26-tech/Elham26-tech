package main

import "testing"

func TestExtractSymbolsWithoutISIN(t *testing.T) {
	// پاسخی مثل ایزی‌تریدر واقعی: گروه‌بندی‌شده و بدون کد ISIN.
	raw := []byte(`{"groups":[{"title":"سهام","items":[
		{"id":41302,"symbolName":"تابان","companyName":"گروه پتروشیمی تابان فردا"},
		{"id":55110,"symbolName":"تابا","companyName":"تابان نیرو سپاهان"}]}]}`)
	hits := extractSymbols(raw)
	if len(hits) != 2 {
		t.Fatalf("تعداد نتایج: %d", len(hits))
	}
	if hits[0].Symbol != "تابان" || hits[0].ISIN != "41302" {
		t.Errorf("نتیجهٔ اول: %+v", hits[0])
	}
	if hits[1].Name != "تابان نیرو سپاهان" {
		t.Errorf("نام شرکت: %+v", hits[1])
	}
}

func TestExtractSymbolsPrefersISINWhenPresent(t *testing.T) {
	raw := []byte(`{"items":[{"id":7,"instrumentId":"IRO1FOLD0001","lVal18AFC":"فولاد"}]}`)
	hits := extractSymbols(raw)
	if len(hits) != 1 || hits[0].ISIN != "IRO1FOLD0001" {
		t.Errorf("باید ISIN را ترجیح بدهد: %+v", hits)
	}
}

func TestBodyMentionsHandlesEscapedPersian(t *testing.T) {
	if !bodyMentions(`{"name":"تابان"}`, "تابان") {
		t.Error("متن خام پیدا نشد")
	}
	// همان متن، ولی به شکل \uXXXX که بعضی سرورها می‌فرستند.
	if !bodyMentions(`{"name":"\u062a\u0627\u0628\u0627\u0646"}`, "تابان") {
		t.Error("متن \\u-دار پیدا نشد")
	}
	if bodyMentions(`{"name":"فولاد"}`, "تابان") {
		t.Error("نباید تطبیق می‌داد")
	}
}
