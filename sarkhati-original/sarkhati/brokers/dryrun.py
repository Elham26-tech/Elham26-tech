"""کارگزار شبیه‌ساز: همه‌چیز را اجرا می‌کند جز ارسال واقعی سفارش."""

from __future__ import annotations

import logging
import time

from ..risk import Order
from .base import OrderResult

log = logging.getLogger(__name__)


class DryRunBroker:
    def __init__(self, name: str = "dryrun", simulated_latency: float = 0.030) -> None:
        self.name = name
        self.simulated_latency = simulated_latency
        self._order: Order | None = None
        self._price: int = 0

    def prepare(self, order: Order, price: int) -> None:
        self._order, self._price = order, price
        log.info("[شبیه‌سازی] سفارش آماده شد: %s %s×%s", order.symbol, order.quantity, price)

    def send(self, attempt: int) -> OrderResult:
        time.sleep(self.simulated_latency)
        assert self._order is not None, "prepare() فراخوانی نشده است"
        return OrderResult(
            accepted=True,
            detail=f"[شبیه‌سازی] تلاش {attempt + 1} — سفارش واقعی ارسال نشد",
        )

    def close(self) -> None:  # pragma: no cover - چیزی برای بستن نیست
        pass
