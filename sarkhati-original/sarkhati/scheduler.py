"""زمان‌بندی با دقت زیرمیلی‌ثانیه.

``time.sleep`` روی سیستم‌عامل‌های معمول خطای ۱ تا ۱۵ میلی‌ثانیه دارد؛ پس تا
چند میلی‌ثانیه مانده به هدف می‌خوابیم و بقیه را با حلقهٔ اشغال (busy-wait)
روی ``time.perf_counter`` می‌شماریم.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Callable

from .timesync import ClockOffset

log = logging.getLogger(__name__)

DEFAULT_SPIN_WINDOW = 0.020
"""چند ثانیه مانده به هدف وارد حلقهٔ اشغال شویم."""


def precise_wait(local_deadline: float, spin_window: float = DEFAULT_SPIN_WINDOW) -> float:
    """تا ``local_deadline`` (epoch محلی) صبر می‌کند و خطای واقعی را برمی‌گرداند.

    خروجی مثبت یعنی دیرتر از هدف بیدار شده‌ایم.
    """
    while True:
        remaining = local_deadline - time.time()
        if remaining <= spin_window:
            break
        # نصف فاصله را می‌خوابیم تا خطای انباشتهٔ sleep کنترل شود.
        time.sleep(min(remaining - spin_window, max(remaining / 2, 0.001)))
    while time.time() < local_deadline:
        pass
    return time.time() - local_deadline


@dataclass
class FirePlan:
    """برنامهٔ شلیک: لحظهٔ هدف روی ساعت سرور و تلاش‌های پشتیبان."""

    target_server_epoch: float
    lead_time: float = 0.0
    """چند ثانیه زودتر بفرستیم تا بستهٔ ما سرِ ساعت به سرور برسد (≈ نصف RTT)."""

    retries: int = 2
    """تعداد تلاش پشتیبان در صورت رد شدن سفارش (علاوه بر تلاش اول)."""

    retry_gap: float = 0.040
    """فاصلهٔ بین تلاش‌ها به ثانیه."""

    def attempt_times(self) -> list[float]:
        """لحظهٔ ارسال هر تلاش روی ساعت سرور."""
        first = self.target_server_epoch - self.lead_time
        return [first + i * self.retry_gap for i in range(self.retries + 1)]


@dataclass
class AttemptRecord:
    index: int
    scheduled_server_epoch: float
    sent_server_epoch: float
    latency: float
    accepted: bool
    detail: str

    @property
    def timing_error(self) -> float:
        return self.sent_server_epoch - self.scheduled_server_epoch


def run_plan(
    plan: FirePlan,
    clock: ClockOffset,
    send: Callable[[int], tuple[bool, str]],
    *,
    spin_window: float = DEFAULT_SPIN_WINDOW,
) -> list[AttemptRecord]:
    """تلاش‌ها را طبق برنامه اجرا می‌کند و با اولین پذیرش متوقف می‌شود."""
    records: list[AttemptRecord] = []
    for index, scheduled in enumerate(plan.attempt_times()):
        deadline = clock.local_deadline(scheduled)
        now = time.time()
        if deadline < now - 0.5 and index == 0:
            log.warning("لحظهٔ هدف %.3f ثانیه گذشته است؛ فوراً ارسال می‌شود", now - deadline)
        elif deadline > now:
            precise_wait(deadline, spin_window=spin_window)
        sent_at = clock.now()
        started = time.perf_counter()
        accepted, detail = send(index)
        latency = time.perf_counter() - started
        record = AttemptRecord(
            index=index,
            scheduled_server_epoch=scheduled,
            sent_server_epoch=sent_at,
            latency=latency,
            accepted=accepted,
            detail=detail,
        )
        records.append(record)
        log.info(
            "تلاش %d: خطای زمانی %+.1fms، تأخیر پاسخ %.1fms، نتیجه=%s (%s)",
            index + 1,
            record.timing_error * 1000,
            latency * 1000,
            "پذیرفته" if accepted else "رد",
            detail,
        )
        if accepted:
            break
    return records
