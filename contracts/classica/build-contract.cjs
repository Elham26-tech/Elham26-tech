/*
 * قالب Word قرارداد طراحی سایت، سئو و هوش مصنوعی — مجموعه کلاسیکا
 *
 * ساخت دوباره فایل:
 *   npm install --no-save docx@9 vazirmatn
 *   node contracts/classica/build-contract.cjs
 *
 * فونت Vazirmatn FD (ارقام فارسی) درون فایل docx جاسازی می‌شود تا روی
 * سیستمی که این فونت را ندارد هم ظاهر سند حفظ شود.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');
const {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  HeightRule,
  ImageRun,
  LevelFormat,
  LineRuleType,
  Packer,
  PageNumber,
  Paragraph,
  SectionType,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} = require('docx');

const OUT = process.argv[2] || path.join(__dirname, 'classica-contract-template.docx');
const LOGO = fs.readFileSync(path.join(__dirname, 'classica-logo.png'));
const LOGO_RATIO = 1298 / 421;
const FONT_DIR = path.join(path.dirname(require.resolve('vazirmatn/package.json')), 'misc/Farsi-Digits/fonts/ttf');

// ---------------------------------------------------------------- brand
const FONT = 'Vazirmatn FD';
const FONT_BLACK = 'Vazirmatn FD Black';
const C = {
  yellow: 'FAB509', // زرد لوگو
  blue: '1668A2', // آبی خطوط لوگو
  navy: '0E3B5E',
  blueSoft: 'EAF2F9',
  blueLine: 'C3D7E8',
  yellowSoft: 'FFF5DA',
  zebra: 'F7FAFD',
  text: '2B2F36',
  muted: '6B7785',
  ph: '9AAABB',
  white: 'FFFFFF',
};
const SZ = { body: 20, small: 17, tiny: 15, h: 23 };

// A4
const PAGE = { w: 11906, h: 16838 };
const MARGIN_X = 1134;
const W = PAGE.w - MARGIN_X * 2; // عرض متن

// ---------------------------------------------------------------- text helpers
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
// «~» در متن‌های این فایل همان نیم‌فاصله است
const fa = (s) => String(s).replace(/~/g, '‌').replace(/[0-9]/g, (d) => FA_DIGITS[d]);

function run(text, o = {}) {
  return new TextRun({
    text: fa(text),
    font: o.font || FONT,
    size: o.size || SZ.body,
    bold: o.bold,
    color: o.color || C.text,
    rightToLeft: true,
    language: { value: 'en-US', bidirectional: 'fa-IR' },
  });
}

const blank = (n = 10, o = {}) => run('…'.repeat(n), { ...o, color: C.ph, bold: false });

function box(o = {}) {
  return new TextRun({ text: '☐', font: 'MS Gothic', size: o.size || SZ.body, color: C.blue, rightToLeft: true });
}

// ‎**پررنگ**‎ و ‎__‎ (جای خالی، طول = تعداد زیرخط) و ‎[ ]‎ (چک‌باکس)
function rich(text, o = {}) {
  return String(text)
    .replace(/\[ \] /g, '[ ] ') // چک‌باکس از برچسبش جدا نشود
    .split(/(\*\*.+?\*\*|_{2,}|\[ \])/)
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith('**')) return run(part.slice(2, -2), { ...o, bold: true, color: o.strongColor || C.navy });
      if (/^_{2,}$/.test(part)) return blank(part.length, o);
      if (part === '[ ]') return box(o);
      return run(part, o);
    });
}

function para(children, o = {}) {
  return new Paragraph({
    children: Array.isArray(children) ? children : [children],
    bidirectional: true,
    alignment: o.align || AlignmentType.BOTH,
    spacing: {
      before: o.before ?? 0,
      after: o.after ?? 110,
      line: o.line ?? 290,
      lineRule: o.lineRule || LineRuleType.AUTO,
    },
    indent: o.indent,
    shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
    border: o.border,
    keepNext: o.keepNext,
    keepLines: o.keepLines,
    pageBreakBefore: o.pageBreakBefore,
    heading: o.heading,
    numbering: o.numbering,
  });
}

const spacer = (h = 200, o = {}) => para([], { after: 0, line: h, lineRule: LineRuleType.EXACT, ...o });

const clause = (num, text, o = {}) =>
  para([run(`${num}. `, { bold: true, color: C.blue }), ...rich(text)], { ...o, keepLines: true });

const bullet = (text) => para(rich(text), { numbering: { reference: 'dot', level: 0 }, after: 60 });

const note = (text, label = 'تبصره') =>
  para([run(`${label}: `, { bold: true, color: C.navy, size: SZ.small }), ...rich(text, { size: SZ.small })], {
    fill: C.yellowSoft,
    indent: { start: 240, end: 240 },
    before: 40,
    after: 140,
    keepLines: true,
  });

// ---------------------------------------------------------------- table helpers
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const line = (color = C.blueLine, size = 4) => ({ style: BorderStyle.SINGLE, size, color });
const gridBorders = {
  top: line(),
  bottom: line(),
  left: line(),
  right: line(),
  insideHorizontal: line(),
  insideVertical: line(),
};

function cell(content, o = {}) {
  const children = Array.isArray(content)
    ? content
    : [
        para(typeof content === 'string' ? rich(content, o.run || {}) : content, {
          align: o.align || AlignmentType.START,
          after: 0,
          line: o.line ?? 276,
          keepNext: o.keepNext,
          heading: o.heading,
        }),
      ];
  return new TableCell({
    children,
    width: { size: o.w, type: WidthType.DXA },
    columnSpan: o.span,
    verticalAlign: o.valign || VerticalAlign.CENTER,
    shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
    borders: o.borders,
    margins: o.margins || { top: 70, bottom: 70, left: 130, right: 130 },
  });
}

function table(widths, rows, o = {}) {
  return new Table({
    visuallyRightToLeft: true,
    layout: TableLayoutType.FIXED,
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    borders: o.borders || gridBorders,
    rows,
  });
}

const headRun = { bold: true, color: C.white, size: SZ.small, strongColor: C.white };

/** جدول داده با سطر عنوان سرمه‌ای، سطرهای راه‌راه و سطرهای جمع زرد کم‌رنگ */
function dataTable(cols, rows) {
  const widths = cols.map((c) => c.w);
  const header = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: cols.map((c) =>
      cell(c.title, { w: c.w, fill: C.navy, align: AlignmentType.CENTER, run: headRun, keepNext: true }),
    ),
  });
  const body = rows.map((r, i) => {
    const total = r.total;
    const cells = r.cells || r;
    let col = 0;
    return new TableRow({
      cantSplit: true,
      height: { value: r.h || 460, rule: HeightRule.ATLEAST },
      children: cells.map((c) => {
        const spec = typeof c === 'string' ? { text: c } : c;
        const span = spec.span || 1;
        const w = widths.slice(col, col + span).reduce((a, b) => a + b, 0);
        const align = cols[col].align || AlignmentType.START;
        col += span;
        return cell(spec.text, {
          w,
          span: span > 1 ? span : undefined,
          align: spec.align || align,
          fill: total ? C.yellowSoft : i % 2 ? C.zebra : undefined,
          run: { size: SZ.small, bold: total || spec.bold, color: total ? C.navy : C.text },
        });
      }),
    });
  });
  return table(widths, [header, ...body]);
}

/** سطرهای برچسب | مقدار | برچسب | مقدار — سطر دوتایی، مقدار را تا انتها می‌کشد */
const KV_W = [1850, 2969, 1850, 2969];
function kvRows(rows, h = 470) {
  const label = (t) => cell(t, { w: KV_W[0], fill: C.blueSoft, run: { bold: true, color: C.navy, size: SZ.small } });
  const value = (t, w = KV_W[1], span) => cell(t || '', { w, span, run: { size: SZ.small } });
  return rows.map(
    (r) =>
      new TableRow({
        cantSplit: true,
        height: { value: r.h || h, rule: HeightRule.ATLEAST },
        children:
          r.length === 2 ? [label(r[0]), value(r[1], W - KV_W[0], 3)] : [label(r[0]), value(r[1]), label(r[2]), value(r[3])],
      }),
  );
}

/** جدول مشخصات طرفین با سطر عنوان سرمه‌ای */
function partyTable(title, subtitle, rows) {
  const head = new TableRow({
    cantSplit: true,
    children: [
      cell(
        [
          para([run(title, { bold: true, color: C.white, size: SZ.h - 2 }), run(`   ${subtitle}`, { color: C.yellow, size: SZ.small, bold: true })], {
            align: AlignmentType.START,
            after: 0,
            keepNext: true,
          }),
        ],
        { w: W, span: 4, fill: C.navy, margins: { top: 100, bottom: 100, left: 180, right: 180 } },
      ),
    ],
  });
  return table(KV_W, [head, ...kvRows(rows)]);
}

/**
 * عنوان هر ماده: برچسب زرد درون نوار آبی کم‌رنگ.
 * پاراگراف است نه جدول، تا «با بعدی نگه دار» در Word و LibreOffice هر دو کار کند.
 * حاشیه‌های هم‌رنگ پس‌زمینه فقط نقش فاصله داخلی نوار را دارند.
 */
function article(badge, title, o = {}) {
  const pad = (space) => ({ style: BorderStyle.SINGLE, size: 4, color: C.blueSoft, space });
  const nb = '\u00a0';
  return [
    new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.START,
      heading: HeadingLevel.HEADING_1,
      keepNext: true,
      keepLines: true,
      pageBreakBefore: o.pageBreak,
      spacing: { before: o.pageBreak ? 0 : 340, after: 200, line: 276 },
      indent: { start: 120, end: 120 },
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.blueSoft },
      border: { top: pad(5), bottom: pad(5), left: pad(6), right: pad(6) },
      children: [
        new TextRun({
          text: fa(`${nb}${nb}${badge}${nb}${nb}`),
          font: FONT,
          size: SZ.body,
          bold: true,
          color: C.navy,
          rightToLeft: true,
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.yellow },
        }),
        run(`${nb}${nb}${nb}${title}`, { bold: true, color: C.navy, size: SZ.h }),
      ],
    }),
  ];
}

const logo = (width) =>
  new ImageRun({
    type: 'png',
    data: LOGO,
    transformation: { width, height: Math.round(width / LOGO_RATIO) },
    altText: { name: 'Classica', title: 'کلاسیکا', description: 'لوگوی مجموعه کلاسیکا' },
  });

// ---------------------------------------------------------------- header / footer
const bodyHeader = new Header({
  children: [
    table(
      [W / 2, W / 2],
      [
        new TableRow({
          children: [
            cell([para(logo(128), { align: AlignmentType.START, after: 0 })], { w: W / 2, margins: { top: 0, bottom: 40, left: 0, right: 0 } }),
            cell(
              [
                ['شماره قرارداد: ', 14],
                ['تاریخ: ', 14],
                ['پیوست: ', 14],
              ].map(([t, n]) =>
                para([run(t, { bold: true, color: C.navy, size: SZ.tiny }), blank(n, { size: SZ.tiny })], {
                  align: AlignmentType.END,
                  after: 0,
                  line: 240,
                }),
              ),
              { w: W / 2, valign: VerticalAlign.BOTTOM, margins: { top: 0, bottom: 40, left: 0, right: 0 } },
            ),
          ],
        }),
      ],
      { borders: noBorders },
    ),
    para([], { after: 0, line: 60, lineRule: LineRuleType.EXACT, border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: C.yellow, space: 1 } } }),
  ],
});

const sigSlot = (label) =>
  para([run(label, { bold: true, color: C.navy, size: SZ.tiny }), blank(14, { size: SZ.tiny })], { align: AlignmentType.CENTER, after: 0, line: 240 });

const bodyFooter = new Footer({
  children: [
    table(
      [3600, W - 7200, 3600],
      [
        new TableRow({
          children: [
            cell([sigSlot('امضای مجری: ')], { w: 3600 }),
            cell(
              [
                new Paragraph({
                  bidirectional: true,
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      children: ['صفحه ', PageNumber.CURRENT, ' از ', PageNumber.TOTAL_PAGES_IN_SECTION],
                      font: FONT,
                      size: SZ.tiny,
                      color: C.muted,
                      rightToLeft: true,
                    }),
                  ],
                }),
              ],
              { w: W - 7200 },
            ),
            cell([sigSlot('امضای کارفرما: ')], { w: 3600 }),
          ],
        }),
      ],
      { borders: { ...noBorders, top: line(C.blueLine, 6) } },
    ),
  ],
});

const coverHeader = new Header({ children: [para([], { after: 0 })] });

const coverFooter = new Footer({
  children: [
    para(run('این سند محرمانه است و مفاد آن تنها میان طرفین قرارداد اعتبار دارد.', { size: SZ.tiny, color: C.muted }), {
      align: AlignmentType.CENTER,
      after: 100,
    }),
    table(
      [W],
      [
        new TableRow({
          children: [
            cell(
              [
                para(
                  [
                    run('کلاسیکا', { bold: true, color: C.yellow, size: SZ.body }),
                    run('    طراحی وب~سایت   •   سئو   •   هوش مصنوعی', { color: C.white, size: SZ.small }),
                  ],
                  { align: AlignmentType.CENTER, after: 0 },
                ),
              ],
              { w: W, fill: C.navy, margins: { top: 130, bottom: 130, left: 200, right: 200 } },
            ),
          ],
        }),
      ],
      { borders: { ...noBorders, top: { style: BorderStyle.SINGLE, size: 24, color: C.yellow } } },
    ),
  ],
});

// ---------------------------------------------------------------- cover
function serviceCard(num, title, desc, w) {
  return cell(
    [
      para(run(num, { font: FONT_BLACK, size: 34, color: C.yellow }), { align: AlignmentType.START, after: 20, line: 240 }),
      para(run(title, { bold: true, color: C.navy, size: SZ.body }), { align: AlignmentType.START, after: 40, line: 260 }),
      para(run(desc, { color: C.muted, size: SZ.tiny }), { align: AlignmentType.START, after: 0, line: 250 }),
    ],
    {
      w,
      fill: C.blueSoft,
      valign: VerticalAlign.TOP,
      borders: { top: { style: BorderStyle.SINGLE, size: 24, color: C.yellow }, bottom: NONE, left: NONE, right: NONE },
      margins: { top: 160, bottom: 180, left: 200, right: 200 },
    },
  );
}

const gap = 260;
const cardW = (W - gap * 2) / 3;
const gapCell = () => cell('', { w: gap });

const coverMeta = table(
  KV_W,
  kvRows(
    [
      ['شماره قرارداد', '', 'تاریخ انعقاد', '______ / ______ / ______'],
      ['مجری', '**مجموعه کلاسیکا**', 'کارفرما', ''],
      ['مدت قرارداد', '', 'مبلغ کل (ریال)', ''],
    ],
    520,
  ),
);

const cover = [
  spacer(1300),
  para(logo(330), { align: AlignmentType.CENTER, after: 520 }),
  para(run('قرارداد همکاری', { bold: true, color: C.blue, size: 26 }), { align: AlignmentType.CENTER, after: 60 }),
  para(run('طراحی وب~سایت، سئو', { font: FONT_BLACK, color: C.navy, size: 58 }), { align: AlignmentType.CENTER, after: 0, line: 300 }),
  para([run('و خدمات ', { font: FONT_BLACK, color: C.navy, size: 58 }), run('هوش مصنوعی', { font: FONT_BLACK, color: C.blue, size: 58 })], {
    align: AlignmentType.CENTER,
    after: 120,
    line: 300,
  }),
  para([], {
    after: 240,
    line: 120,
    lineRule: LineRuleType.EXACT,
    indent: { start: 4200, end: 4200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 36, color: C.yellow, space: 1 } },
  }),
  para(run('سند توافق خدمات دیجیتال میان مجموعه کلاسیکا و کارفرما', { color: C.muted, size: SZ.body }), {
    align: AlignmentType.CENTER,
    after: 800,
  }),
  table(
    [cardW, gap, cardW, gap, cardW],
    [
      new TableRow({
        cantSplit: true,
        children: [
          serviceCard('01', 'طراحی و توسعه وب~سایت', 'رابط کاربری اختصاصی، واکنش~گرا، سریع و امن', cardW),
          gapCell(),
          serviceCard('02', 'بهینه~سازی برای موتورهای جستجو', 'سئوی فنی، محتوایی و خارجی با گزارش ماهانه', cardW),
          gapCell(),
          serviceCard('03', 'راهکارهای هوش مصنوعی', 'دستیار گفتگو، تولید محتوا و خودکارسازی فرایندها', cardW),
        ],
      }),
    ],
    { borders: noBorders },
  ),
  spacer(700),
  coverMeta,
];

// ---------------------------------------------------------------- body
const P = (text, o) => para(rich(text), o);

const body = [
  para(run('بسمه تعالی', { bold: true, color: C.muted, size: SZ.small }), { align: AlignmentType.CENTER, after: 80 }),
  para(run('قرارداد طراحی وب~سایت، سئو و خدمات هوش مصنوعی', { bold: true, color: C.navy, size: 32 }), {
    align: AlignmentType.CENTER,
    after: 200,
  }),
  P(
    'این قرارداد به استناد **ماده 10 قانون مدنی** و با رعایت سایر قوانین و مقررات جاری کشور، میان طرفین مشروح زیر منعقد گردید و طرفین با آگاهی کامل از مفاد آن، خود را ملزم به اجرای کلیه شروط و تعهدات مندرج در آن می~دانند.',
    { after: 60 },
  ),

  // ۱
  ...article('ماده 1', 'طرفین قرارداد'),
  partyTable('طرف اول: مجری', 'مجموعه کلاسیکا', [
    ['نام مجموعه', '**کلاسیکا**', 'نوع شخصیت', '[ ] حقیقی     [ ] حقوقی'],
    ['نماینده قانونی', '', 'سمت', ''],
    ['کد ملی / شناسه ملی', '', 'شماره ثبت', ''],
    ['کد اقتصادی', '', 'کد پستی', ''],
    ['تلفن', '', 'تلفن همراه', ''],
    ['ایمیل', '', 'وب~سایت', ''],
    ['نشانی', ''],
  ]),
  spacer(200),
  partyTable('طرف دوم: کارفرما', '', [
    ['نام شخص / شرکت', '', 'نوع شخصیت', '[ ] حقیقی     [ ] حقوقی'],
    ['نماینده قانونی', '', 'سمت', ''],
    ['کد ملی / شناسه ملی', '', 'شماره ثبت', ''],
    ['کد اقتصادی', '', 'کد پستی', ''],
    ['تلفن', '', 'تلفن همراه', ''],
    ['ایمیل', '', 'دامنه وب~سایت', ''],
    ['نشانی', ''],
  ]),
  spacer(160),
  clause('1-1', 'در این قرارداد، طرف اول **«مجری»** و طرف دوم **«کارفرما»** نامیده می~شوند.'),
  clause(
    '1-2',
    'نشانی~های مندرج در این ماده، اقامتگاه قانونی طرفین است و هر مکاتبه~ای به این نشانی~ها ابلاغ~شده تلقی می~شود. هر طرف موظف است تغییر نشانی خود را ظرف 7 روز کتباً به طرف دیگر اطلاع دهد؛ در غیر این صورت، ابلاغ به نشانی پیشین معتبر است.',
  ),

  // ۲
  ...article('ماده 2', 'موضوع قرارداد'),
  P(
    'موضوع قرارداد عبارت است از ارائه خدمات زیر از سوی مجری به کارفرما، مطابق شرح خدمات ماده 3 و مشخصات فنی **پیوست الف**. خدمات مورد توافق در ستون نخست علامت زده می~شود:',
    { keepNext: true },
  ),
  dataTable(
    [
      { title: 'انتخاب', w: 900, align: AlignmentType.CENTER },
      { title: 'خدمت', w: 3000 },
      { title: 'شرح مختصر', w: W - 3900 },
    ],
    [
      ['[ ]', '**طراحی و توسعه وب~سایت**', 'طراحی رابط و تجربه کاربری، پیاده~سازی، راه~اندازی و تحویل وب~سایت'],
      ['[ ]', '**بهینه~سازی برای موتورهای جستجو (سئو)**', 'سئوی فنی، محتوایی و خارجی برای بهبود رتبه و افزایش ورودی ارگانیک'],
      ['[ ]', '**خدمات هوش مصنوعی**', 'دستیار گفتگوی هوشمند (چت~بات)، تولید محتوا و خودکارسازی فرایندها'],
      ['[ ]', '**پشتیبانی و نگهداری**', 'رفع اشکال، به~روزرسانی و نگهداری فنی پس از تحویل'],
    ],
  ),

  // ۳
  ...article('ماده 3', 'شرح خدمات'),
  clause('3-1', '**طراحی و توسعه وب~سایت** شامل موارد زیر است:', { keepNext: true }),
  bullet('بررسی نیازها، تحلیل رقبا و تدوین نقشه سایت با مشارکت کارفرما؛'),
  bullet('طراحی اختصاصی رابط و تجربه کاربری (UI/UX) متناسب با هویت بصری کارفرما، در قالب ____ طرح پیشنهادی و حداکثر ____ نوبت اصلاح؛'),
  bullet('پیاده~سازی وب~سایت واکنش~گرا (Responsive) و سازگار با مرورگرهای رایج و تلفن همراه؛'),
  bullet('راه~اندازی پنل مدیریت برای ویرایش صفحات، مطالب و محصولات توسط کارفرما؛'),
  bullet('نصب گواهی امنیتی (SSL)، پیکربندی امنیتی پایه و تنظیم پشتیبان~گیری دوره~ای؛'),
  bullet('بهینه~سازی سرعت بارگذاری و رعایت اصول پایه سئو در ساختار فنی سایت؛'),
  bullet('بارگذاری محتوای اولیه ارائه~شده از سوی کارفرما تا سقف ____ صفحه؛'),
  bullet('آموزش کار با پنل مدیریت و تحویل راهنمای کاربری.'),
  clause('3-2', '**بهینه~سازی برای موتورهای جستجو (سئو)** شامل موارد زیر است:', { keepNext: true, before: 80 }),
  bullet('ممیزی فنی و محتوایی سایت و ارائه گزارش وضعیت اولیه؛'),
  bullet('تحقیق و انتخاب کلمات کلیدی هدف با هماهنگی کارفرما؛'),
  bullet('سئوی فنی: ساختار نشانی~ها، نقشه سایت XML، داده~های ساختاریافته (Schema)، سرعت و شاخص~های Core Web Vitals؛'),
  bullet('سئوی داخلی: بهینه~سازی عنوان~ها، توضیحات متا، سرفصل~ها، تصاویر و پیوندهای داخلی؛'),
  bullet('تدوین تقویم محتوایی و تولید ____ محتوای بهینه در هر ماه؛'),
  bullet('سئوی خارجی و لینک~سازی اصولی مطابق رهنمودهای موتورهای جستجو؛'),
  bullet('راه~اندازی و پایش Google Search Console و Google Analytics؛'),
  bullet('ارائه گزارش ماهانه شامل جایگاه کلمات کلیدی، ورودی ارگانیک و اقدامات انجام~شده.'),
  note(
    'رتبه~بندی نتایج جستجو در اختیار موتورهای جستجو است و به عوامل متعددی خارج از کنترل مجری بستگی دارد؛ از این رو تعهد مجری، اجرای صحیح و اصولی اقدامات این بند است و تضمینی برای کسب رتبه یا جایگاه مشخص داده نمی~شود.',
  ),
  clause('3-3', '**خدمات هوش مصنوعی** شامل موارد زیر است:', { keepNext: true }),
  bullet('تحلیل فرایندهای کسب~وکار کارفرما و شناسایی فرصت~های به~کارگیری هوش مصنوعی؛'),
  bullet('طراحی و پیاده~سازی دستیار گفتگوی هوشمند (چت~بات) برای پاسخ~گویی و پشتیبانی کاربران، بر پایه اطلاعات ارائه~شده از سوی کارفرما؛'),
  bullet('راه~اندازی ابزارهای تولید و بهینه~سازی محتوا به کمک هوش مصنوعی، با نظارت انسانی؛'),
  bullet('خودکارسازی فرایندهای تکراری مانند پاسخ به فرم~ها، دسته~بندی درخواست~ها و گزارش~گیری؛'),
  bullet('اتصال وب~سایت و سامانه~های کارفرما به سرویس~های هوش مصنوعی از طریق رابط برنامه~نویسی (API)؛'),
  bullet('آزمون و ارزیابی کیفیت پاسخ~ها و تنظیم عملکرد سامانه پیش از تحویل؛'),
  bullet('آموزش کارکنان کارفرما برای بهره~برداری از ابزارهای پیاده~سازی~شده.'),
  clause(
    '3-4',
    'هر خدمت یا امکانی که صراحتاً در این ماده یا پیوست الف ذکر نشده باشد، خارج از موضوع قرارداد است و انجام آن مستلزم توافق کتبی و تعیین هزینه جداگانه مطابق ماده 12 خواهد بود.',
    { before: 80 },
  ),

  // ۴
  ...article('ماده 4', 'مدت قرارداد و زمان~بندی اجرا'),
  clause(
    '4-1',
    'مدت اجرای خدمات طراحی و توسعه ____ روز کاری و مدت خدمات سئو ____ ماه است و از تاریخ دریافت پیش~پرداخت و تحویل کامل اطلاعات و محتوای لازم از سوی کارفرما آغاز می~شود. زمان~بندی مراحل به شرح زیر است:',
    { keepNext: true },
  ),
  dataTable(
    [
      { title: 'مرحله', w: 900, align: AlignmentType.CENTER },
      { title: 'شرح فعالیت', w: 3300 },
      { title: 'مدت (روز کاری)', w: 1700, align: AlignmentType.CENTER },
      { title: 'خروجی قابل تحویل', w: W - 5900 },
    ],
    [
      ['1', 'تحلیل نیاز و برنامه~ریزی', '', 'سند نیازمندی~ها و نقشه سایت'],
      ['2', 'طراحی رابط و تجربه کاربری', '', 'طرح صفحات برای تأیید کارفرما'],
      ['3', 'پیاده~سازی و توسعه', '', 'نسخه آزمایشی وب~سایت'],
      ['4', 'پیاده~سازی راهکارهای هوش مصنوعی', '', 'دستیار هوشمند و ابزارهای فعال~شده'],
      ['5', 'آزمون، راه~اندازی و آموزش', '', 'وب~سایت نهایی و راهنمای کاربری'],
      ['6', 'سئو و پایش مستمر', '____ ماه', 'گزارش~های ماهانه عملکرد'],
    ],
  ),
  spacer(140),
  clause(
    '4-2',
    'کارفرما موظف است حداکثر ظرف 3 روز کاری پس از تحویل هر مرحله، نظر خود را کتباً اعلام کند؛ در صورت عدم اعلام نظر در این مهلت، آن مرحله تأییدشده تلقی می~شود.',
  ),
  clause(
    '4-3',
    'تأخیر ناشی از قصور کارفرما در ارائه اطلاعات، محتوا، دسترسی~ها یا تأییدها به مدت قرارداد افزوده می~شود و تأخیر مجری محسوب نمی~گردد.',
  ),

  // ۵
  ...article('ماده 5', 'مبلغ قرارداد و نحوه پرداخت'),
  clause('5-1', 'مبلغ کل قرارداد __________ ریال (به حروف: ______________ ریال) است که به شرح زیر تعیین می~شود:', { keepNext: true }),
  dataTable(
    [
      { title: 'ردیف', w: 900, align: AlignmentType.CENTER },
      { title: 'شرح خدمات', w: W - 3900 },
      { title: 'مبلغ (ریال)', w: 3000, align: AlignmentType.CENTER },
    ],
    [
      ['1', 'طراحی و توسعه وب~سایت', ''],
      ['2', 'سئو — ____ ماه (ماهانه ________ ریال)', ''],
      ['3', 'خدمات هوش مصنوعی', ''],
      ['4', 'پشتیبانی و نگهداری', ''],
      { total: true, cells: [{ text: 'جمع کل', span: 2 }, ''] },
      { total: true, cells: [{ text: 'مالیات بر ارزش افزوده (در صورت شمول)', span: 2 }, ''] },
      { total: true, cells: [{ text: 'مبلغ قابل پرداخت', span: 2 }, ''] },
    ],
  ),
  spacer(140),
  clause('5-2', 'مبلغ قرارداد در مراحل زیر پرداخت می~شود:', { keepNext: true }),
  dataTable(
    [
      { title: 'مرحله پرداخت', w: 1900 },
      { title: 'زمان پرداخت', w: W - 5900 },
      { title: 'سهم', w: 1000, align: AlignmentType.CENTER },
      { title: 'مبلغ (ریال)', w: 3000, align: AlignmentType.CENTER },
    ],
    [
      ['**پیش~پرداخت**', 'هنگام امضای قرارداد', '40٪', ''],
      ['**پرداخت دوم**', 'پس از تأیید طرح~های گرافیکی (پایان مرحله 2)', '30٪', ''],
      ['**تسویه نهایی**', 'پیش از انتقال نهایی وب~سایت و دسترسی~ها', '30٪', ''],
      ['**هزینه سئو**', 'ابتدای هر ماه از دوره خدمات سئو', 'ماهانه', ''],
    ],
  ),
  spacer(140),
  clause('5-3', 'پرداخت~ها به حساب زیر انجام می~شود و رسید بانکی ملاک پرداخت است:', { keepNext: true }),
  table(
    KV_W,
    kvRows([
      ['شماره حساب', '', 'شماره شبا', 'IR'],
      ['بانک و شعبه', '', 'صاحب حساب', ''],
    ]),
  ),
  spacer(140),
  clause(
    '5-4',
    'هزینه ثبت و تمدید دامنه، میزبانی (هاست)، لایسنس قالب~ها و افزونه~های تجاری و هزینه مصرف سرویس~های هوش مصنوعی شخص ثالث (مانند هزینه فراخوانی API بر اساس میزان مصرف) در مبلغ قرارداد منظور نشده و بر عهده کارفرماست، مگر آنکه در جدول بند 5-1 صراحتاً درج شده باشد.',
  ),
  clause(
    '5-5',
    'در صورت تأخیر کارفرما در پرداخت هر یک از اقساط بیش از 7 روز، مجری حق دارد تا زمان پرداخت، اجرای تعهدات خود را متوقف کند و مدت توقف به مدت قرارداد افزوده می~شود.',
  ),

  // ۶
  ...article('ماده 6', 'تعهدات مجری'),
  clause('6-1', 'انجام خدمات موضوع قرارداد با رعایت اصول فنی و استانداردهای روز و در مهلت~های مقرر.'),
  clause('6-2', 'به~کارگیری نیروی متخصص و پاسخ~گویی به کارفرما در ساعات اداری از طریق راه~های ارتباطی توافق~شده.'),
  clause('6-3', 'ارائه گزارش پیشرفت کار در پایان هر مرحله و گزارش ماهانه خدمات سئو.'),
  clause('6-4', 'خودداری از به~کارگیری محتوا، تصاویر، کدها یا نرم~افزارهای غیرمجاز و رعایت حقوق مالکیت فکری اشخاص ثالث.'),
  clause('6-5', 'تحویل کلیه دسترسی~ها، رمزهای عبور، فایل~های منبع موضوع ماده 8 و مستندات فنی، پس از تسویه~حساب کامل.'),
  clause('6-6', 'رعایت اصول امنیت اطلاعات و حفاظت از داده~هایی که در اجرای قرارداد در اختیار مجری قرار می~گیرد.'),

  // ۷
  ...article('ماده 7', 'تعهدات کارفرما'),
  clause('7-1', 'پرداخت به~موقع مبالغ قرارداد مطابق ماده 5.'),
  clause(
    '7-2',
    'تحویل اطلاعات، محتوا (متن، تصویر، لوگو و مانند آن)، دسترسی~ها و مستندات لازم، حداکثر ظرف ____ روز کاری از تاریخ امضای قرارداد.',
  ),
  clause(
    '7-3',
    'معرفی یک نماینده تام~الاختیار برای هماهنگی و تأیید مراحل: آقا/خانم __________ به شماره تماس __________.',
  ),
  clause(
    '7-4',
    'مسئولیت صحت، قانونی بودن و مالکیت محتوا و داده~هایی که کارفرما برای درج در وب~سایت یا آموزش سامانه~های هوش مصنوعی ارائه می~کند، بر عهده خود اوست.',
  ),
  clause(
    '7-5',
    'اخذ مجوزهای لازم برای فعالیت وب~سایت (مانند نماد اعتماد الکترونیکی، در صورت نیاز) بر عهده کارفرماست و مجری همکاری فنی لازم را خواهد داشت.',
  ),
  clause(
    '7-6',
    'در دوره گارانتی، هرگونه تغییر فنی در کدها یا تنظیمات سایت توسط اشخاص دیگر باید با هماهنگی مجری انجام شود؛ در غیر این صورت، تعهد گارانتی مجری نسبت به بخش~های تغییریافته ساقط می~شود.',
  ),

  // ۸
  ...article('ماده 8', 'مالکیت فکری'),
  clause(
    '8-1',
    'پس از تسویه~حساب کامل، حقوق مادی طرح~های گرافیکی اختصاصی، محتوای تولیدشده و کدهای اختصاصی نوشته~شده برای این پروژه به کارفرما منتقل می~شود. تا پیش از تسویه کامل، این حقوق متعلق به مجری است.',
  ),
  clause(
    '8-2',
    'ابزارها، ماژول~ها و کدهای عمومی که مجری پیش~تر توسعه داده یا در سایر پروژه~ها به کار می~برد، و نیز نرم~افزارهای متن~باز و سرویس~های شخص ثالث، مشمول انتقال مالکیت نیستند و کارفرما تنها حق استفاده از آن~ها را در همین پروژه و مطابق مجوز مربوط خواهد داشت.',
  ),
  clause(
    '8-3',
    'مجری مجاز است نام، لوگو و تصویر صفحات وب~سایت کارفرما را به~عنوان نمونه~کار معرفی کند، مگر آنکه کارفرما کتباً مخالفت نماید. درج عبارت «طراحی و توسعه: کلاسیکا» در پانویس سایت، با رضایت کارفرما مجاز است.',
  ),

  // ۹
  ...article('ماده 9', 'محرمانگی و حفاظت از داده~ها'),
  clause(
    '9-1',
    'طرفین متعهدند کلیه اطلاعات تجاری، فنی، مالی و داده~های کاربران را که در اجرای قرارداد در اختیارشان قرار می~گیرد محرمانه تلقی کنند و بدون رضایت کتبی طرف دیگر، آن را افشا نکرده یا جز برای اجرای قرارداد به کار نبرند.',
  ),
  clause(
    '9-2',
    'مجری داده~های کارفرما را تنها برای اجرای موضوع قرارداد پردازش می~کند و از ارسال اطلاعات شخصی یا محرمانه غیرضروری به سرویس~های هوش مصنوعی شخص ثالث خودداری می~نماید. فهرست این سرویس~ها پیش از پیاده~سازی به اطلاع کارفرما می~رسد.',
  ),
  clause('9-3', 'تعهد محرمانگی تا ____ سال پس از خاتمه یا فسخ قرارداد به قوت خود باقی است.'),

  // ۱۰
  ...article('ماده 10', 'ملاحظات ویژه خدمات هوش مصنوعی'),
  clause(
    '10-1',
    'خروجی سامانه~های هوش مصنوعی ماهیتی احتمالاتی دارد و ممکن است در مواردی نادرست یا ناقص باشد. مجری تمهیدات فنی معقول را برای کاهش خطا به کار می~گیرد، اما صحت کامل خروجی~ها را تضمین نمی~کند.',
  ),
  clause(
    '10-2',
    'بازبینی، تأیید و انتشار نهایی محتوای تولیدشده با هوش مصنوعی و تصمیم~هایی که بر مبنای خروجی این سامانه~ها گرفته می~شود، بر عهده کارفرماست.',
  ),
  clause(
    '10-3',
    'عملکرد راهکارهای مبتنی بر سرویس~های شخص ثالث به دسترس~پذیری، سیاست~ها و تعرفه~های ارائه~دهندگان آن~ها وابسته است. در صورت تغییر یا توقف این سرویس~ها، مجری جایگزین~های فنی را پیشنهاد می~کند و اجرای آن، اگر به کار اضافی نیاز داشته باشد، طبق ماده 12 انجام می~شود.',
  ),
  clause(
    '10-4',
    'کارفرما متعهد است از راهکارهای هوش مصنوعی تحویلی در چارچوب قوانین و مقررات کشور و بدون تضییع حقوق دیگران استفاده کند.',
  ),

  // ۱۱
  ...article('ماده 11', 'پشتیبانی و گارانتی'),
  clause('11-1', 'مجری به مدت ____ ماه پس از تحویل نهایی، رفع رایگان اشکالات فنی ناشی از عملکرد خود را تضمین می~کند.'),
  clause('11-2', 'مجری حداکثر ظرف ____ ساعت کاری از دریافت گزارش اشکال، بررسی و رفع آن را آغاز می~کند.'),
  clause(
    '11-3',
    'پشتیبانی شامل رفع اشکال، به~روزرسانی~های امنیتی و پاسخ~گویی فنی است و افزودن امکانات یا صفحات جدید، تغییر طراحی و تولید محتوا را در بر نمی~گیرد.',
  ),
  clause('11-4', 'پشتیبانی پس از دوره گارانتی، به درخواست کارفرما و طبق قرارداد جداگانه ارائه می~شود.'),

  // ۱۲
  ...article('ماده 12', 'تغییرات و درخواست~های خارج از محدوده'),
  clause(
    '12-1',
    'هر درخواست تغییر یا افزودن خدمات خارج از شرح خدمات باید کتباً (از جمله از طریق ایمیل یا پیام~رسان توافق~شده) اعلام شود. مجری ظرف 3 روز کاری هزینه و زمان لازم را برآورد می~کند و پس از تأیید کتبی کارفرما، آن را اجرا می~نماید.',
  ),
  clause('12-2', 'تغییر اساسی در طرح~های تأییدشده پس از آغاز مرحله پیاده~سازی، کار اضافی محسوب می~شود و هزینه جداگانه دارد.'),

  // ۱۳
  ...article('ماده 13', 'تأخیر و وجه التزام'),
  clause(
    '13-1',
    'در صورت تأخیر غیرموجه مجری در تحویل هر مرحله، به ازای هر روز تأخیر معادل ____ درصد مبلغ همان مرحله به~عنوان وجه التزام از مطالبات مجری کسر می~شود، مشروط بر آنکه مجموع آن از 10 درصد مبلغ کل قرارداد بیشتر نشود.',
  ),
  clause('13-2', 'تأخیرهای ناشی از قصور کارفرما یا قوه قاهره مشمول این ماده نیست.'),

  // ۱۴
  ...article('ماده 14', 'فسخ قرارداد'),
  clause(
    '14-1',
    'در صورت تخلف هر یک از طرفین از تعهدات خود و عدم رفع آن ظرف 10 روز از تاریخ اخطار کتبی طرف دیگر، طرف زیان~دیده حق فسخ قرارداد را دارد.',
  ),
  clause(
    '14-2',
    'در صورت فسخ، کار انجام~شده تا تاریخ فسخ ارزیابی و بر اساس درصد پیشرفت تسویه~حساب می~شود؛ پیش~پرداخت به میزان کار انجام~شده قابل استرداد نیست.',
  ),
  clause('14-3', 'انصراف کارفرما پس از آغاز کار و بدون تقصیر مجری، موجب تعلق بهای کار انجام~شده تا آن تاریخ به مجری است.'),

  // ۱۵
  ...article('ماده 15', 'قوه قاهره (فورس ماژور)'),
  P(
    'در صورت بروز حوادث غیرقابل پیش~بینی و خارج از اراده طرفین، مانند بلایای طبیعی، جنگ، اختلال گسترده و طولانی در زیرساخت اینترنت یا تصمیمات حاکمیتی مؤثر بر اجرای قرارداد، تعهدات طرفین تا رفع آن وضعیت معلق می~شود. اگر این وضعیت بیش از 30 روز ادامه یابد، هر یک از طرفین می~تواند با تسویه~حساب کار انجام~شده، قرارداد را فسخ کند.',
  ),

  // ۱۶
  ...article('ماده 16', 'حل اختلاف'),
  P(
    'هرگونه اختلاف در تفسیر یا اجرای این قرارداد ابتدا از راه مذاکره حل~وفصل می~شود. در صورت عدم توافق ظرف 15 روز، موضوع به داور مرضی~الطرفین (آقا/خانم __________) ارجاع می~شود و رأی داور برای طرفین لازم~الاجراست. در صورت عدم امکان داوری، مراجع صالح قضایی شهر ________ مرجع رسیدگی خواهند بود.',
  ),

  // ۱۷
  ...article('ماده 17', 'نسخ قرارداد'),
  para(
    rich(
      'این قرارداد در **17 ماده** و **2 پیوست**، در دو نسخه با اعتبار یکسان تنظیم و پس از مطالعه کامل به امضای طرفین رسید. پیوست~ها و هر الحاقیه~ای که به امضای طرفین برسد جزء لاینفک قرارداد است. مکاتبات الکترونیکی از طریق ایمیل~های درج~شده در ماده 1، در حکم مکاتبه کتبی است.',
    ),
    { keepNext: true },
  ),

  // امضا
  spacer(300, { keepNext: true }),
  signatures(),
];

function signatures() {
  const sw = (W - 300) / 2;
  const head = (t, sub) =>
    cell(
      [
        para([run(t, { bold: true, color: C.white, size: SZ.body }), run(sub ? `   ${sub}` : '', { bold: true, color: C.yellow, size: SZ.small })], {
          align: AlignmentType.CENTER,
          after: 0,
          keepNext: true,
        }),
      ],
      { w: sw, fill: C.navy, margins: { top: 110, bottom: 110, left: 160, right: 160 } },
    );
  const lines = (first) =>
    cell(
      [
        ...(first ? [para(rich(first), { align: AlignmentType.START, after: 100 })] : []),
        ...['نام و نام خانوادگی: ________________', 'سمت: ________________', 'تاریخ: ______ / ______ / ______'].map((t) =>
          para(rich(t, { size: SZ.small }), { align: AlignmentType.START, after: 110 }),
        ),
        para(run('مهر و امضا', { bold: true, color: C.navy, size: SZ.small }), { align: AlignmentType.START, after: 900 }),
      ],
      { w: sw, valign: VerticalAlign.TOP, borders: { top: NONE, bottom: line(), left: line(), right: line() }, margins: { top: 160, bottom: 120, left: 200, right: 200 } },
    );
  return table(
    [sw, 300, sw],
    [
      new TableRow({ cantSplit: true, children: [head('طرف اول: مجری', 'کلاسیکا'), cell('', { w: 300 }), head('طرف دوم: کارفرما')] }),
      new TableRow({ cantSplit: true, children: [lines('**مجموعه کلاسیکا**'), cell('', { w: 300 }), lines('**نام کارفرما:** ______________')] }),
    ],
    { borders: noBorders },
  );
}

// ---------------------------------------------------------------- appendices
const briefRow = (label, value, h) => ({ h, cells: [`**${label}**`, value] });
const appendixA = [
  ...article('پیوست الف', 'مشخصات فنی پروژه', { pageBreak: true }),
  P('این پیوست پیش از آغاز کار با همکاری کارفرما تکمیل می~شود و مبنای اجرای خدمات است.', { keepNext: true }),
  dataTable(
    [
      { title: 'مورد', w: 2800 },
      { title: 'مشخصات', w: W - 2800 },
    ],
    [
      briefRow('نوع وب~سایت', '[ ] شرکتی    [ ] فروشگاهی    [ ] آموزشی    [ ] خبری / مجله    [ ] سایر: ________'),
      briefRow('بستر پیاده~سازی', '[ ] وردپرس    [ ] برنامه~نویسی اختصاصی    [ ] سایر: ________'),
      briefRow('زبان~های سایت', '[ ] فارسی    [ ] انگلیسی    [ ] سایر: ________'),
      briefRow('تعداد صفحات / بخش~ها', ''),
      briefRow('امکانات ویژه', '[ ] درگاه پرداخت    [ ] عضویت کاربران    [ ] رزرو آنلاین    [ ] وبلاگ    [ ] سایر: ________', 620),
      briefRow('دامنه و میزبانی', '[ ] در اختیار کارفرماست    [ ] توسط مجری تهیه شود'),
      briefRow('کلمات کلیدی هدف سئو', '', 700),
      briefRow('رقبا و سایت~های الگو', '', 700),
      briefRow('راهکارهای هوش مصنوعی', '[ ] چت~بات پشتیبانی    [ ] تولید محتوا    [ ] خودکارسازی فرایندها    [ ] سیستم پیشنهاددهنده    [ ] سایر: ________', 620),
      briefRow('منابع داده برای دستیار هوشمند', '', 700),
      briefRow('توضیحات تکمیلی', '', 1400),
    ],
  ),
];

const appendixB = [
  ...article('پیوست ب', 'صورتجلسه تحویل و تأیید مراحل', { pageBreak: true }),
  P('با تحویل هر مرحله، نماینده کارفرما وضعیت آن را در این جدول ثبت و امضا می~کند.', { keepNext: true }),
  dataTable(
    [
      { title: 'مرحله', w: 2600 },
      { title: 'تاریخ تحویل', w: 1500, align: AlignmentType.CENTER },
      { title: 'وضعیت', w: 2700 },
      { title: 'امضای کارفرما', w: W - 6800, align: AlignmentType.CENTER },
    ],
    [
      'تحلیل نیاز و برنامه~ریزی',
      'طراحی رابط و تجربه کاربری',
      'پیاده~سازی و توسعه',
      'راهکارهای هوش مصنوعی',
      'آزمون، راه~اندازی و آموزش',
      'تحویل نهایی و انتقال دسترسی~ها',
    ].map((t) => ({ h: 760, cells: [`**${t}**`, '', '[ ] تأیید    [ ] نیاز به اصلاح', ''] })),
  ),
  spacer(240),
  table(KV_W, kvRows([['ملاحظات', '']], 1500)),
];

// ---------------------------------------------------------------- document
const pageProps = (extra = {}) => ({
  page: {
    size: { width: PAGE.w, height: PAGE.h },
    margin: { top: 1900, bottom: 1300, left: MARGIN_X, right: MARGIN_X, header: 560, footer: 480 },
    ...extra,
  },
});

const doc = new Document({
  creator: 'Classica',
  title: 'قرارداد طراحی وب‌سایت، سئو و خدمات هوش مصنوعی — کلاسیکا',
  description: 'قالب قرارداد مجموعه کلاسیکا',
  styles: {
    default: {
      document: {
        run: { font: FONT, size: SZ.body, color: C.text, language: { value: 'en-US', bidirectional: 'fa-IR' } },
        paragraph: { alignment: AlignmentType.BOTH },
      },
      heading1: {
        run: { font: FONT, size: SZ.h, bold: true, color: C.navy },
        paragraph: { spacing: { before: 0, after: 0 } },
      },
    },
  },
  numbering: {
    config: [
      {
        reference: 'dot',
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.START,
            style: {
              paragraph: { indent: { start: 620, hanging: 280 } },
              run: { font: FONT, color: C.yellow, bold: true },
            },
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: pageProps({ margin: { top: 1200, bottom: 1300, left: MARGIN_X, right: MARGIN_X, header: 560, footer: 480 } }),
      headers: { default: coverHeader },
      footers: { default: coverFooter },
      children: cover,
    },
    {
      properties: { ...pageProps({ pageNumbers: { start: 1 } }), type: SectionType.NEXT_PAGE },
      headers: { default: bodyHeader },
      footers: { default: bodyFooter },
      children: [...body, ...appendixA, ...appendixB],
    },
  ],
});

// تعداد صفحات متن قرارداد (بدون جلد) برای مقدار اولیه فیلد SECTIONPAGES؛
// Word هنگام صفحه‌آرایی آن را به‌روز می‌کند و این عدد فقط برای نرم‌افزارهایی است که این فیلد را نمی‌شناسند.
const BODY_PAGES = 10;

// ---------------------------------------------------------------- font embedding
// docx-js فقط وزن regular را جاسازی می‌کند؛ اینجا regular و bold و black را خودمان اضافه می‌کنیم.
function obfuscate(buf, guid) {
  const key = Buffer.from(guid.replace(/-/g, ''), 'hex').reverse();
  const out = Buffer.from(buf);
  for (let i = 0; i < 32; i++) out[i] ^= key[i % 16];
  return out;
}

async function embedFonts(docxBuffer) {
  const zip = await JSZip.loadAsync(docxBuffer);
  const faces = [
    { family: FONT, slot: 'embedRegular', file: 'Vazirmatn-FD-Regular.ttf' },
    { family: FONT, slot: 'embedBold', file: 'Vazirmatn-FD-Bold.ttf' },
    { family: FONT_BLACK, slot: 'embedRegular', file: 'Vazirmatn-FD-Black.ttf' },
  ];
  const sig = '<w:sig w:usb0="80002003" w:usb1="80000000" w:usb2="00000008" w:usb3="00000000" w:csb0="00000041" w:csb1="20080000"/>';
  const rels = [];
  const byFamily = new Map();
  faces.forEach((f, i) => {
    const guid = crypto.randomUUID().toUpperCase();
    const target = `fonts/font${i + 1}.odttf`;
    zip.file(`word/${target}`, obfuscate(fs.readFileSync(path.join(FONT_DIR, f.file)), guid));
    rels.push(
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="${target}"/>`,
    );
    const list = byFamily.get(f.family) || [];
    list.push(`<w:${f.slot} r:id="rId${i + 1}" w:fontKey="{${guid}}"/>`);
    byFamily.set(f.family, list);
  });
  const fonts = [...byFamily]
    .map(
      ([name, embeds]) =>
        `<w:font w:name="${name}"><w:charset w:val="00"/><w:family w:val="auto"/><w:pitch w:val="variable"/>${sig}${embeds.join('')}</w:font>`,
    )
    .join('');
  zip.file(
    'word/fontTable.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:fonts xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      fonts +
      '</w:fonts>',
  );
  zip.file(
    'word/_rels/fontTable.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels.join('') +
      '</Relationships>',
  );

  let types = await zip.file('[Content_Types].xml').async('string');
  if (!types.includes('Extension="odttf"')) {
    types = types.replace(
      '<Default ',
      '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/><Default ',
    );
  }
  zip.file('[Content_Types].xml', types);

  let docRels = await zip.file('word/_rels/document.xml.rels').async('string');
  if (!docRels.includes('fontTable.xml')) {
    docRels = docRels.replace(
      '</Relationships>',
      '<Relationship Id="rIdFontTable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>',
    );
    zip.file('word/_rels/document.xml.rels', docRels);
  }

  let settings = await zip.file('word/settings.xml').async('string');
  if (!settings.includes('embedTrueTypeFonts')) {
    // ترتیب عناصر settings در schema مهم است: embedTrueTypeFonts پس از این عناصر می‌آید
    const before =
      'writeProtection|view|zoom|removePersonalInformation|removeDateAndTime|doNotDisplayPageBoundaries|displayBackgroundShape|printPostScriptOverText|printFractionalCharacterWidth|printFormsData';
    settings = settings.replace(new RegExp(`(<w:settings[^>]*>)((?:<w:(?:${before})\\b[^>]*/>)*)`), '$1$2<w:embedTrueTypeFonts/>');
    zip.file('word/settings.xml', settings);
  }
  for (const name of Object.keys(zip.files).filter((n) => /^word\/footer\d+\.xml$/.test(n))) {
    const xml = await zip.file(name).async('string');
    zip.file(
      name,
      xml.replace(
        /(<w:instrText[^>]*>SECTIONPAGES<\/w:instrText><w:fldChar w:fldCharType="separate"\/>)/g,
        `$1<w:t>${BODY_PAGES}</w:t>`,
      ),
    );
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

Packer.toBuffer(doc)
  .then(embedFonts)
  .then((buf) => {
    fs.writeFileSync(OUT, buf);
    console.log(`wrote ${OUT} (${Math.round(buf.length / 1024)} KB)`);
  });
