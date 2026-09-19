"""چسبِ بین ساعت، کنترل ریسک و کارگزار."""

from __future__ import annotations

import logging
import statistics
import time
from dataclasses import dataclass
from datetime import datetime

from . import risk, timesync
from .brokers import build_broker
from .config import AppConfig, tehran_tz
from .scheduler import AttemptRecord, FirePlan, run_plan

log = logging.getLogger(__name__)

PREPARE_BEFORE_S = 45.0
"""چند ثانیه مانده به هدف، اتصال‌ها برقرار و پیام ساخته شود."""

KEEPALIVE_EVERY_S = 10.0


@dataclass
class RunReport:
    target_epoch: float
    price: int
    clock: timesync.ClockOffset
    lead_time: float
    attempts: list[AttemptRecord]
    live: bool

    @property
    def accepted(self) -> bool:
        return any(a.accepted for a in self.attempts)

    def render(self) -> str:
        tz = tehran_tz()
        target = datetime.fromtimestamp(self.target_epoch, tz)
        lines = [
            "",
            "═" * 52,
            f"لحظهٔ هدف   : {target:%Y-%m-%d %H:%M:%S}.{target.microsecond // 1000:03d} (تهران)",
            f"قیمت ارسالی : {self.price:,} ریال",
            f"ساعت        : {self.clock.describe()}",
            f"پیش‌فرست     : {self.lead_time * 1000:.0f}ms",
            f"حالت        : {'زنده' if self.live else 'شبیه‌سازی'}",
            "─" * 52,
        ]
        for attempt in self.attempts:
            lines.append(
                f"تلاش {attempt.index + 1}: خطای زمانی {attempt.timing_error * 1000:+7.1f}ms | "
                f"پاسخ {attempt.latency * 1000:6.1f}ms | "
                f"{'پذیرفته' if attempt.accepted else 'رد'} — {attempt.detail}"
            )
        if not self.attempts:
            lines.append("هیچ تلاشی انجام نشد.")
        lines.append("═" * 52)
        return "\n".join(lines)


def sync_clock(config: AppConfig) -> timesync.ClockOffset:
    return timesync.sync(
        method=config.clock.method,
        ntp_servers=config.clock.ntp_servers,
        http_url=config.clock.http_url or None,
    )


def measure_lead_time(config: AppConfig) -> float:
    """پیش‌فرست = نصف زمان رفت‌وبرگشت، تا سفارش دقیقاً سرِ ساعت *برسد*."""
    configured = config.schedule.lead_ms
    if configured != "auto":
        return float(configured) / 1000
    url = config.clock.http_url or config.broker.settings.get("base_url", "")
    if not url:
        return 0.0
    rtts = timesync.estimate_rtt(url)
    if not rtts:
        log.warning("اندازه‌گیری RTT ممکن نشد؛ پیش‌فرست صفر در نظر گرفته شد")
        return 0.0
    lead = statistics.median(rtts) / 2
    log.info("RTT میانه %.1fms → پیش‌فرست %.1fms", statistics.median(rtts) * 1000, lead * 1000)
    return lead


def prepare_order(config: AppConfig) -> tuple[risk.Order, int, list[str]]:
    order = config.order
    problems = risk.validate(order, config.price_rules, config.risk)
    price = 0
    if not problems:
        price = risk.resolve_price(order, config.price_rules)
    return order, price, problems


def execute(config: AppConfig, *, live: bool, skip_wait: bool = False) -> RunReport:
    """جریان کامل: اعتبارسنجی ← همگام‌سازی ← گرم‌کردن ← شلیک ← گزارش."""
    order, price, problems = prepare_order(config)
    if problems:
        raise ValueError("سفارش معتبر نیست:\n- " + "\n- ".join(problems))

    clock = sync_clock(config)
    log.info("ساعت همگام شد: %s", clock.describe())
    if live and clock.uncertainty * 1000 > config.clock.max_uncertainty_ms:
        raise RuntimeError(
            f"عدم‌قطعیت ساعت ({clock.uncertainty * 1000:.0f}ms) از حد مجاز "
            f"({config.clock.max_uncertainty_ms:.0f}ms) بیشتر است؛ ارسال زنده متوقف شد"
        )

    target = config.schedule.target_epoch()
    lead = measure_lead_time(config)
    if skip_wait:
        # حالت تست: بدون انتظار تا بازگشایی، یک ثانیهٔ دیگر شلیک می‌کنیم.
        target = clock.now() + 1.0 + lead
        log.info("حالت --now فعال است؛ لحظهٔ هدف به یک ثانیهٔ دیگر منتقل شد")
    broker = build_broker(config.broker.name, config.broker.settings, live=live)

    try:
        if not skip_wait:
            _wait_and_warm(broker, order, price, clock, target, lead)
        else:
            broker.prepare(order, price)

        # همگام‌سازی دوباره درست قبل از شلیک: رانش ساعت در ۴۵ ثانیه ناچیز است،
        # ولی اگر ساعت سیستم وسط کار پرش کند این تصحیح نجات‌بخش است.
        remaining = clock.local_deadline(target) - time.time()
        if not skip_wait and remaining > 3:
            fresh = sync_clock(config)
            if fresh.uncertainty <= clock.uncertainty * 1.5:
                log.info("همگام‌سازی نهایی: %s", fresh.describe())
                clock = fresh

        plan = FirePlan(
            target_server_epoch=target,
            lead_time=lead,
            retries=config.schedule.retries,
            retry_gap=config.schedule.retry_gap_ms / 1000,
        )
        attempts = run_plan(plan, clock, lambda i: _send(broker, i))
    finally:
        broker.close()

    return RunReport(
        target_epoch=target,
        price=price,
        clock=clock,
        lead_time=lead,
        attempts=attempts,
        live=live,
    )


def _send(broker, index: int) -> tuple[bool, str]:
    result = broker.send(index)
    return result.accepted, result.detail


def _wait_and_warm(broker, order, price, clock, target, lead) -> None:
    """تا PREPARE_BEFORE_S مانده به هدف صبر، بعد اتصال‌ها را گرم نگه می‌دارد."""
    prepare_at = clock.local_deadline(target - lead - PREPARE_BEFORE_S)
    now = time.time()
    if prepare_at > now:
        wait = prepare_at - now
        log.info("%.0f ثانیه تا آماده‌سازی اتصال‌ها…", wait)
        _countdown_sleep(wait)
    broker.prepare(order, price)

    keepalive = getattr(broker, "keepalive", None)
    while True:
        remaining = clock.local_deadline(target - lead) - time.time()
        if remaining <= 2.0:
            break
        if keepalive and remaining > KEEPALIVE_EVERY_S + 2:
            time.sleep(KEEPALIVE_EVERY_S)
            keepalive()
        else:
            time.sleep(min(0.5, max(remaining - 2.0, 0.01)))
    log.info("آمادهٔ شلیک؛ %.2f ثانیه مانده", max(remaining, 0))


def _countdown_sleep(seconds: float) -> None:
    end = time.time() + seconds
    while True:
        left = end - time.time()
        if left <= 0:
            return
        if left > 60:
            time.sleep(30)
        else:
            time.sleep(min(left, 5))
