# SangBazar — راهنمای توسعه

اپلیکیشن موبایل «سنگ‌بازار»: پلتفرم جامع دیجیتال صنعت سنگ و معدن.

## Stack
- Expo SDK 57 / React Native 0.86 / React 19، TypeScript strict
- مسیریابی: `expo-router` (فایل‌محور، در پوشه `app/`)
- state: `zustand` (`src/store/`)، ماندگاری با AsyncStorage و SecureStore
- بدون کتابخانه UI بیرونی — همه‌چیز در `src/components/`

## قواعد
- **دوزبانه (fa/en)**: هیچ متنی مستقیم در صفحه نوشته نمی‌شود. کلید را به `src/i18n/fa.ts` اضافه کنید؛ `fa` منبع نوع است و `en.ts` علیه آن type-check می‌شود.
- **RTL**: جهت از `useTheme().isRtl` می‌آید و روی هر `flexDirection` اعمال می‌شود؛ از `I18nManager.forceRTL` استفاده نکنید (نیاز به restart دارد).
- **اعداد**: همیشه از `src/lib/format.ts` یا هوک `useFormatters()` — اعداد فارسی و قیمت بر اساس زبان فعال.
- **رنگ‌ها**: فقط از `useTheme().colors` و توکن‌های `src/theme/index.ts`؛ رنگ hard-code ممنوع (پوسته تیره/روشن).
- **API**: هر فراخوانی از `src/api/services.ts` می‌گذرد. بک‌اند ماک داخلی است؛ با `EXPO_PUBLIC_USE_MOCK_BACKEND=false` و `EXPO_PUBLIC_API_BASE_URL` به سرور واقعی سوییچ می‌شود. شکل درخواست/پاسخ در `src/api/types.ts` قفل است.

## دستورها
```bash
npm start          # Expo dev server
npm run typecheck  # tsc --noEmit — قبل از هر commit
npx expo export --platform web   # بیلد تست (EXPO_OFFLINE=1 اگر شبکه محدود است)
```
