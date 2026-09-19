"""قواعد قیمت و کنترل‌های ایمنی سفارش.

هدف این ماژول جلوگیری از «سفارش فاجعه‌بار» است: قیمت خارج از دامنهٔ نوسان،
حجم اشتباه (مثلاً یک صفر اضافه)، یا نمادی که در فهرست مجاز نیست. یک سفارش
سرخطیِ غلط به‌خاطر سرعتش دقیقاً همان چیزی است که قابل جبران نیست.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable

BUY = "buy"
SELL = "sell"


@dataclass
class PriceRules:
    band_pct: float = 3.0
    """دامنهٔ نوسان روزانه بر حسب درصد (بورس معمولاً ۳٪؛ فرابورس و صندوق‌ها فرق دارد)."""

    tick: int = 1
    """گام قیمت به ریال."""

    def limits(self, reference_price: float) -> tuple[int, int]:
        """کف و سقف مجاز روز را بر اساس قیمت پایانی دیروز می‌دهد.

        سقف به سمت پایین و کف به سمت بالا گرد می‌شود تا هیچ‌وقت از دامنه
        بیرون نزند — قیمت بیرون از دامنه یعنی رد شدن سفارش در همان لحظهٔ حساس.
        """
        if reference_price <= 0:
            raise ValueError("قیمت مرجع باید مثبت باشد")
        raw_high = reference_price * (1 + self.band_pct / 100)
        raw_low = reference_price * (1 - self.band_pct / 100)
        high = int(math.floor(raw_high / self.tick) * self.tick)
        low = int(math.ceil(raw_low / self.tick) * self.tick)
        return low, high

    def on_tick(self, price: float) -> bool:
        return abs(price - round(price / self.tick) * self.tick) < 1e-9


@dataclass
class RiskLimits:
    max_order_value: int = 1_000_000_000
    """حداکثر ارزش هر سفارش به ریال. مقدار قانونی را از کارگزار بگیرید."""

    max_quantity: int = 10_000_000
    allowed_symbols: list[str] = field(default_factory=list)
    """اگر خالی باشد هر نمادی مجاز است؛ پرکردنش شدیداً توصیه می‌شود."""

    require_reference_price: bool = True
    """بدون قیمت پایانی دیروز، اعتبارسنجی دامنه ممکن نیست."""


@dataclass
class Order:
    symbol: str
    side: str
    quantity: int
    price: int | None = None
    isin: str = ""
    price_mode: str = "limit"
    """``limit`` قیمت دستی، ``upper_band`` سقف روز، ``lower_band`` کف روز."""

    reference_price: float | None = None
    """قیمت پایانی دیروز؛ مبنای محاسبهٔ دامنهٔ نوسان."""

    validity: str = "day"

    @property
    def value(self) -> int:
        return int((self.price or 0) * self.quantity)


def resolve_price(order: Order, rules: PriceRules) -> int:
    """قیمت نهایی سفارش را حساب می‌کند (سقف/کف دامنه یا قیمت دستی)."""
    if order.price_mode in ("upper_band", "lower_band"):
        if order.reference_price is None:
            raise ValueError("برای قیمت سقف/کف، قیمت پایانی دیروز لازم است")
        low, high = rules.limits(order.reference_price)
        return high if order.price_mode == "upper_band" else low
    if order.price is None:
        raise ValueError("در حالت قیمت دستی، price باید مقدار داشته باشد")
    return int(order.price)


def validate(order: Order, rules: PriceRules, limits: RiskLimits) -> list[str]:
    """فهرست ایرادهای سفارش را برمی‌گرداند؛ لیست خالی یعنی سفارش سالم است."""
    problems: list[str] = []

    if order.side not in (BUY, SELL):
        problems.append(f"سمت سفارش نامعتبر است: {order.side!r} (buy یا sell)")
    if order.quantity <= 0:
        problems.append("حجم سفارش باید مثبت باشد")
    if order.quantity > limits.max_quantity:
        problems.append(f"حجم {order.quantity:,} از سقف {limits.max_quantity:,} بیشتر است")
    if limits.allowed_symbols and order.symbol not in limits.allowed_symbols:
        problems.append(f"نماد {order.symbol} در فهرست مجاز نیست")

    try:
        price = resolve_price(order, rules)
    except ValueError as exc:
        problems.append(str(exc))
        return problems

    if price <= 0:
        problems.append("قیمت باید مثبت باشد")
    if not rules.on_tick(price):
        problems.append(f"قیمت {price:,} مضربی از گام قیمت ({rules.tick}) نیست")

    if order.reference_price is not None:
        low, high = rules.limits(order.reference_price)
        if not low <= price <= high:
            problems.append(
                f"قیمت {price:,} خارج از دامنهٔ مجاز [{low:,} , {high:,}] است"
            )
    elif limits.require_reference_price:
        problems.append("قیمت پایانی دیروز وارد نشده؛ کنترل دامنهٔ نوسان ممکن نیست")

    value = price * order.quantity
    if value > limits.max_order_value:
        problems.append(
            f"ارزش سفارش {value:,} ریال از سقف {limits.max_order_value:,} ریال بیشتر است"
        )
    return problems


def format_preview(order: Order, rules: PriceRules) -> str:
    price = resolve_price(order, rules)
    side = "خرید" if order.side == BUY else "فروش"
    lines = [
        f"نماد      : {order.symbol}" + (f" ({order.isin})" if order.isin else ""),
        f"سمت       : {side}",
        f"حجم       : {order.quantity:,}",
        f"قیمت      : {price:,} ریال ({order.price_mode})",
        f"ارزش کل   : {price * order.quantity:,} ریال",
    ]
    if order.reference_price is not None:
        low, high = rules.limits(order.reference_price)
        lines.append(f"دامنهٔ روز : {low:,} تا {high:,} ریال")
    return "\n".join(lines)


def summarize_symbols(symbols: Iterable[str]) -> str:
    items = list(symbols)
    return "، ".join(items) if items else "(بدون محدودیت)"
