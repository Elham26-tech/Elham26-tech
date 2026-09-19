"""رابط خط فرمان سرخطی‌زن."""

from __future__ import annotations

import argparse
import logging
import statistics
import sys
import time
from datetime import datetime

from . import risk, timesync
from .config import AppConfig, tehran_tz
from .runner import execute, measure_lead_time, prepare_order, sync_clock


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s.%(msecs)03d %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )


def _load(args) -> AppConfig:
    config = AppConfig.load(args.config)
    if getattr(args, "symbol", None):
        config.order.symbol = args.symbol
    if getattr(args, "quantity", None):
        config.order.quantity = args.quantity
    if getattr(args, "at", None):
        config.schedule.target_time = args.at
    return config


def cmd_sync(args) -> int:
    config = _load(args)
    clock = sync_clock(config)
    tz = tehran_tz()
    print(f"ساعت مرجع  : {clock.describe()}")
    print(f"ساعت محلی  : {datetime.now(tz):%H:%M:%S.%f}"[:-3])
    print(f"ساعت تصحیح‌شده: {datetime.fromtimestamp(clock.now(), tz):%H:%M:%S.%f}"[:-3])
    if clock.uncertainty * 1000 > config.clock.max_uncertainty_ms:
        print(f"⚠ عدم‌قطعیت از حد مجاز ({config.clock.max_uncertainty_ms:.0f}ms) بیشتر است")
        return 1
    return 0


def cmd_calibrate(args) -> int:
    config = _load(args)
    url = config.clock.http_url or config.broker.settings.get("base_url", "")
    if not url:
        print("برای اندازه‌گیری تأخیر، clock.http_url یا broker.settings.base_url لازم است")
        return 2
    rtts = timesync.estimate_rtt(url, probes=args.probes)
    if not rtts:
        print(f"هیچ پاسخی از {url} گرفته نشد")
        return 1
    ms = sorted(r * 1000 for r in rtts)
    print(f"نمونه‌ها : {len(ms)}")
    print(f"کمینه   : {ms[0]:.1f}ms")
    print(f"میانه   : {statistics.median(ms):.1f}ms")
    print(f"بیشینه  : {ms[-1]:.1f}ms")
    print(f"پیش‌فرست پیشنهادی: {statistics.median(ms) / 2:.0f}ms")
    return 0


def cmd_bands(args) -> int:
    config = _load(args)
    reference = args.reference or config.order.reference_price
    if not reference:
        print("قیمت پایانی دیروز را با --reference بدهید")
        return 2
    low, high = config.price_rules.limits(reference)
    print(f"قیمت مرجع : {reference:,.0f} ریال (دامنه ±{config.price_rules.band_pct}٪)")
    print(f"کف مجاز   : {low:,} ریال")
    print(f"سقف مجاز  : {high:,} ریال")
    return 0


def cmd_check(args) -> int:
    config = _load(args)
    order, price, problems = prepare_order(config)
    if problems:
        print("✗ سفارش معتبر نیست:")
        for item in problems:
            print(f"  - {item}")
        return 1
    print(risk.format_preview(order, config.price_rules))
    target = config.schedule.target_epoch()
    tz = tehran_tz()
    target_dt = datetime.fromtimestamp(target, tz)
    print(f"لحظهٔ هدف : {target_dt:%Y-%m-%d %H:%M:%S}.{target_dt.microsecond // 1000:03d} (تهران)")
    remaining = target - time.time()
    print(f"فاصله     : {remaining / 3600:.2f} ساعت" if remaining > 0 else "⚠ لحظهٔ هدف گذشته است")
    print(f"کارگزار   : {config.broker.name}")
    lead = measure_lead_time(config)
    print(f"پیش‌فرست  : {lead * 1000:.0f}ms")
    print("✓ پیکربندی سالم است")
    return 0


def cmd_run(args) -> int:
    config = _load(args)
    if args.live:
        order, price, problems = prepare_order(config)
        if problems:
            print("✗ سفارش معتبر نیست:")
            for item in problems:
                print(f"  - {item}")
            return 1
        print(risk.format_preview(order, config.price_rules))
        print("\n⚠ حالت زنده: این سفارش واقعاً به کارگزار ارسال می‌شود.")
        if not args.yes:
            answer = input("برای تأیید عبارت «ارسال» را تایپ کنید: ").strip()
            if answer not in ("ارسال", "send"):
                print("لغو شد.")
                return 130
    report = execute(config, live=args.live, skip_wait=args.now)
    print(report.render())
    return 0 if report.accepted else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sarkhati",
        description="سرخطی‌زن دقیق بورس تهران (ایزی‌تریدر مفید و هر OMS مبتنی بر HTTP)",
    )
    parser.add_argument("-c", "--config", default="config.yaml", help="مسیر فایل پیکربندی")
    parser.add_argument("-v", "--verbose", action="store_true", help="گزارش کامل")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("sync", help="نمایش اختلاف ساعت با مرجع")
    p.set_defaults(func=cmd_sync)

    p = sub.add_parser("calibrate", help="اندازه‌گیری تأخیر شبکه تا کارگزار")
    p.add_argument("--probes", type=int, default=10)
    p.set_defaults(func=cmd_calibrate)

    p = sub.add_parser("bands", help="محاسبهٔ کف و سقف دامنهٔ نوسان")
    p.add_argument("--reference", type=float, help="قیمت پایانی دیروز به ریال")
    p.set_defaults(func=cmd_bands)

    p = sub.add_parser("check", help="اعتبارسنجی پیکربندی و پیش‌نمایش سفارش")
    p.set_defaults(func=cmd_check)

    p = sub.add_parser("run", help="اجرا (پیش‌فرض: شبیه‌سازی بدون ارسال واقعی)")
    p.add_argument("--live", action="store_true", help="ارسال واقعی سفارش")
    p.add_argument("--now", action="store_true", help="بدون انتظار، فوراً اجرا کن (برای تست)")
    p.add_argument("--yes", action="store_true", help="رد کردن پرسش تأیید در حالت زنده")
    p.add_argument("--symbol", help="بازنویسی نماد")
    p.add_argument("--quantity", type=int, help="بازنویسی حجم")
    p.add_argument("--at", help="بازنویسی ساعت هدف، مثلاً 08:30:00.000")
    p.set_defaults(func=cmd_run)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    _setup_logging(args.verbose)
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("\nمتوقف شد.")
        return 130
    except (ValueError, RuntimeError, ConnectionError) as exc:
        print(f"خطا: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
