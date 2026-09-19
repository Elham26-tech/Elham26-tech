# ساخت فایل اجرایی ویندوز

خروجی یک فایل `.exe` تک است که روی ویندوزِ بدون Node هم اجرا می‌شود: نسخهٔ
Node داخل خودِ فایل است و صفحهٔ کنترل هم به‌صورت asset داخلش جا می‌گیرد.

```bash
npm run build:exe
```

مراحل:

1. **باندل** — `esbuild server.js --bundle --platform=node --format=cjs`
   همهٔ ماژول‌های `lib/` در یک فایل جمع می‌شوند، چون داخل فایل اجرایی
   `require` نسبی کار نمی‌کند.
2. **بلاب** — `node --experimental-sea-config build/sea-config.json`
   فایل‌های `public/` هم به‌عنوان asset داخل همین بلاب می‌روند.
3. **تزریق** — `postject` بلاب را داخل `node.exe` ویندوز می‌گذارد:

```bash
cp node.exe sarkhati.exe
node node_modules/postject/dist/cli.js sarkhati.exe NODE_SEA_BLOB build/sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

هشدار `signature seems corrupted` طبیعی است: امضای دیجیتالِ خودِ node.exe با
تزریق باطل می‌شود. اگر ویندوز اخطار SmartScreen داد، «More info → Run anyway».

پوشهٔ داده کنار خود فایل اجرایی ساخته می‌شود (`sarkhati-data`)؛ اگر آنجا
نوشتنی نبود، به `~/.sarkhati` برمی‌گردد.
