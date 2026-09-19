from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ..risk import Order


@dataclass
class OrderResult:
    accepted: bool
    detail: str
    raw: str = ""


class Broker(Protocol):
    """قرارداد مشترک همهٔ مسیرهای ارسال سفارش."""

    name: str

    def prepare(self, order: Order, price: int) -> None:
        """هر کار سنگینی (اتصال، TLS، ساخت پیام) را *قبل از* لحظهٔ شلیک انجام بده."""

    def send(self, attempt: int) -> OrderResult:
        """سفارش آماده‌شده را بفرست. باید تا حد ممکن کوتاه باشد."""

    def close(self) -> None: ...
