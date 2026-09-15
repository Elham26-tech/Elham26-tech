# انبار سنگ — AnbarSang

اپلیکیشن موبایل انبار سنگ، مرجع خرید و فروش سنگ ساختمانی ([anbarsang.com](https://anbarsang.com)). ورود با شماره موبایل و کد یک‌بارمصرف، رابط فارسی راست‌به‌چپ با حالت انگلیسی، و هفت ماژول خدمات.

ساخته‌شده با Expo SDK 57 / React Native — یک کد، خروجی Android و iOS.

---

## گرفتن فایل APK

سه راه، از ساده به کامل:

### ۱. تست فوری بدون build (سریع‌ترین)
اپ **Expo Go** را از Google Play نصب کنید، بعد روی کامپیوتر:

```bash
npm install
npm start
```

QR کد ترمینال را با Expo Go اسکن کنید — اپ روی گوشی اجرا می‌شود. برای تغییر کد نیازی به build دوباره نیست.

### ۲. ساخت APK با EAS Build (بدون نیاز به Android Studio)
Build روی سرورهای Expo انجام می‌شود و لینک دانلود APK به شما می‌دهد. یک حساب رایگان Expo لازم است:

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile preview
```

پروفایل `preview` در `eas.json` روی `buildType: "apk"` تنظیم شده، پس خروجی مستقیماً APK قابل نصب است (نه AAB). در پایان لینک دانلود در ترمینال و در داشبورد expo.dev نمایش داده می‌شود.

برای نسخهٔ انتشار با نسخه‌گذاری خودکار: `eas build -p android --profile production-apk`.

### ۳. ساخت APK به‌صورت لوکال
نیازمند Android Studio با Android SDK و JDK 17+:

```bash
npm install
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

فایل خروجی: `android/app/build/outputs/apk/release/app-release.apk`

> پوشهٔ `android/` در `.gitignore` است چون `prebuild` آن را از روی `app.json` بازتولید می‌کند. تنظیمات native را در `app.json` تغییر دهید، نه داخل `android/`.

---

## اجرا در حالت توسعه

```bash
npm install
npm start          # سرور توسعه Expo
npm run android    # اجرا روی دستگاه/شبیه‌ساز اندروید
npm run ios        # اجرا روی iOS (نیازمند macOS)
npm run web        # اجرا در مرورگر
npm run typecheck  # بررسی نوع‌ها — قبل از هر commit
```

---

## ماژول‌ها

| ماژول | مسیر | امکانات |
|---|---|---|
| ورود با شماره موبایل | `app/(auth)/` | نرمال‌سازی شمارهٔ ایرانی، کد ۶ رقمی با ارسال خودکار، شمارش معکوس ارسال مجدد، انتخاب نقش |
| پنل کارخانه‌داران | `app/mine/` | موجودی بچ‌ها، نمودار تولید هفتگی، سفارش‌های کار با درصد پیشرفت |
| پنل معرفی محصول | `app/(app)/market/` | جستجو، فیلتر دسته، مشخصات فنی، علاقه‌مندی‌ها |
| مزایده زنده | `app/(app)/auction/` | شمارش معکوس، اعتبارسنجی گام پیشنهاد، تاریخچهٔ پیشنهادها |
| نرم‌افزار رندرآن | `app/(app)/renderan/` | پروژه‌های مدل‌شده، کتابخانه تکسچر، بارگذاری تکسچر، رندر آنی، پیشنهاد هوشمند |
| پنل بازاریابی و تبلیغات | `app/affiliate/` | لینک اختصاصی، بازدید/سرنخ/فروش، پورسانت و تسویه |
| شفافیت و لجستیک | `app/logistics/`, `app/tour/` | زمان‌بندی استخراج تا تحویل، تور مجازی ۳۶۰ درجه |
| تجارت بین‌المللی | `app/trade/` | فرم RFQ، مبدل ارز، راهنمای صادرات، چندزبانه |

---

## اتصال به بک‌اند واقعی

اپ با یک بک‌اند ماک داخلی کار می‌کند تا همهٔ صفحه‌ها همین حالا قابل استفاده باشند. کلاینت HTTP، شکل درخواست‌ها و نوع پاسخ‌ها همان‌هایی است که سرور واقعی باید برگرداند (`src/api/types.ts`).

برای سوییچ به سرور واقعی، یک فایل `.env` بسازید:

```
EXPO_PUBLIC_USE_MOCK_BACKEND=false
EXPO_PUBLIC_API_BASE_URL=https://api.example.com/v1
```

نقاط انتهایی مورد انتظار در `src/api/services.ts` کنار هر تابع مشخص شده‌اند — از جمله `POST /auth/otp` و `POST /auth/verify` برای ورود با شماره موبایل.

---

## ساختار

```
app/            صفحه‌ها (expo-router، فایل‌محور)
src/api/        کلاینت HTTP، سرویس‌ها، نوع‌ها، دادهٔ نمونه
src/components/ اجزای UI مشترک
src/i18n/       دیکشنری فارسی و انگلیسی
src/lib/        فرمت اعداد/تاریخ فارسی، هوک‌ها
src/store/      وضعیت احراز هویت و تنظیمات (zustand)
src/theme/      توکن‌های رنگ، فاصله و تایپوگرافی
```
