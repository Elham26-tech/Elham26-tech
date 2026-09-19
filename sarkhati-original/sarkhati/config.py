"""بارگذاری و اعتبارسنجی پیکربندی."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date as date_cls, datetime, time as time_cls, timedelta, timezone
from pathlib import Path
from typing import Any

from .risk import Order, PriceRules, RiskLimits

try:  # منطقهٔ زمانی ایران؛ اگر پایگاه دادهٔ tz نبود، آفست ثابت +۰۳:۳۰
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - پایتون قدیمی
    ZoneInfo = None  # type: ignore[assignment]

IRAN_FIXED = timezone(timedelta(hours=3, minutes=30), "Asia/Tehran")
"""ایران از سال ۱۴۰۱ ساعت تابستانی ندارد، پس آفست ثابت است."""

_TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$")


def tehran_tz():
    if ZoneInfo is not None:
        try:
            return ZoneInfo("Asia/Tehran")
        except Exception:  # noqa: BLE001 - نبود tzdata روی بعضی سیستم‌ها
            pass
    return IRAN_FIXED


def parse_clock_time(value: str) -> time_cls:
    match = _TIME_RE.match(value.strip())
    if not match:
        raise ValueError(f"قالب ساعت نامعتبر است: {value!r} (مثال: 08:30:00.000)")
    hour, minute, second, frac = match.groups()
    micro = int((frac or "0").ljust(6, "0")) if frac else 0
    return time_cls(int(hour), int(minute), int(second or 0), micro)


@dataclass
class ScheduleConfig:
    target_time: str = "08:30:00.000"
    date: str = "today"
    timezone_name: str = "Asia/Tehran"
    lead_ms: float | str = "auto"
    """چند میلی‌ثانیه زودتر ارسال شود. ``auto`` یعنی نصف RTT اندازه‌گیری‌شده."""

    retries: int = 2
    retry_gap_ms: float = 40.0
    resync_before_s: float = 90.0
    """چند ثانیه مانده به هدف، ساعت دوباره همگام شود."""

    def target_epoch(self, now: datetime | None = None) -> float:
        tz = tehran_tz() if self.timezone_name in ("Asia/Tehran", "", None) else _named_tz(self.timezone_name)
        now = now or datetime.now(tz)
        clock = parse_clock_time(self.target_time)
        if self.date in ("today", "امروز", ""):
            day = now.astimezone(tz).date()
        elif self.date in ("tomorrow", "فردا"):
            day = now.astimezone(tz).date() + timedelta(days=1)
        elif self.date in ("next", "auto"):
            day = now.astimezone(tz).date()
            if datetime.combine(day, clock, tzinfo=tz) <= now:
                day += timedelta(days=1)
        else:
            day = date_cls.fromisoformat(self.date)
        return datetime.combine(day, clock, tzinfo=tz).timestamp()


def _named_tz(name: str):
    if ZoneInfo is None:
        raise RuntimeError("zoneinfo در دسترس نیست؛ از Asia/Tehran استفاده کنید")
    return ZoneInfo(name)


@dataclass
class ClockConfig:
    method: str = "auto"
    ntp_servers: list[str] = field(
        default_factory=lambda: ["ntp.sharif.edu", "pool.ntp.org", "time.google.com"]
    )
    http_url: str = ""
    max_uncertainty_ms: float = 50.0
    """اگر عدم‌قطعیت ساعت از این بیشتر باشد، اجرای زنده متوقف می‌شود."""


@dataclass
class BrokerConfig:
    name: str = "dryrun"
    settings: dict[str, Any] = field(default_factory=dict)


@dataclass
class AppConfig:
    schedule: ScheduleConfig = field(default_factory=ScheduleConfig)
    clock: ClockConfig = field(default_factory=ClockConfig)
    broker: BrokerConfig = field(default_factory=BrokerConfig)
    order: Order = field(default_factory=lambda: Order(symbol="", side="buy", quantity=0))
    price_rules: PriceRules = field(default_factory=PriceRules)
    risk: RiskLimits = field(default_factory=RiskLimits)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AppConfig":
        schedule_raw = dict(data.get("schedule", {}))
        if "timezone" in schedule_raw:
            schedule_raw.setdefault("timezone_name", schedule_raw.pop("timezone"))
        schedule = ScheduleConfig(**_pick(ScheduleConfig, schedule_raw))
        clock = ClockConfig(**_pick(ClockConfig, data.get("clock", {})))
        broker_raw = dict(data.get("broker", {}))
        broker = BrokerConfig(
            name=broker_raw.pop("name", "dryrun"),
            settings=broker_raw.pop("settings", broker_raw),
        )
        order = Order(**_pick(Order, data.get("order", {})))
        risk_raw = dict(data.get("risk", {}))
        rules = PriceRules(**_pick(PriceRules, risk_raw))
        limits = RiskLimits(**_pick(RiskLimits, risk_raw))
        if not clock.http_url and broker.settings.get("base_url"):
            clock.http_url = broker.settings["base_url"]
        return cls(
            schedule=schedule,
            clock=clock,
            broker=broker,
            order=order,
            price_rules=rules,
            risk=limits,
        )

    @classmethod
    def load(cls, path: str | Path) -> "AppConfig":
        path = Path(path)
        text = path.read_text(encoding="utf-8")
        if path.suffix in (".yaml", ".yml"):
            try:
                import yaml  # noqa: PLC0415
            except ImportError as exc:  # pragma: no cover
                raise RuntimeError("برای فایل YAML باید PyYAML نصب باشد") from exc
            data = yaml.safe_load(text) or {}
        else:
            data = json.loads(text)
        if not isinstance(data, dict):
            raise ValueError("ریشهٔ فایل پیکربندی باید یک نگاشت (dict) باشد")
        return cls.from_dict(data)


def _pick(cls: type, data: dict[str, Any]) -> dict[str, Any]:
    """فقط کلیدهایی را نگه می‌دارد که فیلد آن dataclass هستند."""
    fields = set(cls.__dataclass_fields__)  # type: ignore[attr-defined]
    return {k: v for k, v in (data or {}).items() if k in fields}
