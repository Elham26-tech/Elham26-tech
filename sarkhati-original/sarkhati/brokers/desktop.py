"""مسیر جایگزین: راندن مستقیم پنجرهٔ ایزی‌تریدر دسکتاپ.

وقتی به API دسترسی ندارید، همان کاری را می‌کنیم که دست آدم می‌کند، فقط با
دقتِ ساعت اتمی: فرم سفارش را خودتان از قبل پر می‌کنید، این کلاس پنجره را
فعال و نشانگر را روی دکمهٔ «ارسال» می‌برد و دقیقاً سرِ ساعت کلیک می‌زند.

نیازمند ``pyautogui`` (و روی ویندوز ``pygetwindow``) است؛ این‌ها وابستگی
اختیاری‌اند و فقط هنگام استفاده از این مسیر لازم می‌شوند.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from ..risk import Order
from .base import OrderResult

log = logging.getLogger(__name__)


@dataclass
class DesktopBroker:
    mode: str = "click"
    """``click`` روی مختصات دکمه، یا ``hotkey`` برای فشردن کلید میان‌بر."""

    x: int = 0
    y: int = 0
    hotkey: list[str] | None = None
    window_title: str = "EasyTrader"
    name: str = "desktop"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DesktopBroker":
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in data.items() if k in known})

    def __post_init__(self) -> None:
        try:
            import pyautogui  # noqa: PLC0415 - وابستگی اختیاری
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(
                "برای حالت دسکتاپ باید pyautogui نصب باشد: pip install pyautogui"
            ) from exc
        pyautogui.PAUSE = 0  # هر مکث پیش‌فرضی یعنی از دست دادن سرخط
        pyautogui.FAILSAFE = True
        self._gui = pyautogui

    def prepare(self, order: Order, price: int) -> None:
        """پنجره را جلو می‌آورد و نشانگر را سرِ جای دکمه می‌گذارد."""
        self._focus_window()
        if self.mode == "click":
            self._gui.moveTo(self.x, self.y)
            log.info("نشانگر روی (%d, %d) آمادهٔ کلیک است", self.x, self.y)
        else:
            log.info("آمادهٔ فشردن کلید میان‌بر %s", "+".join(self.hotkey or []))
        log.warning(
            "کنترل نهایی با شماست: فرم %s %s×%s باید از قبل در ایزی‌تریدر پر شده باشد",
            order.symbol,
            order.quantity,
            price,
        )

    def _focus_window(self) -> None:
        try:
            import pygetwindow  # noqa: PLC0415 - فقط روی ویندوز
        except Exception:  # noqa: BLE001
            log.info("pygetwindow در دسترس نیست؛ پنجره را دستی فعال نگه دارید")
            return
        matches = [w for w in pygetwindow.getAllWindows() if self.window_title.lower() in w.title.lower()]
        if not matches:
            log.warning("پنجره‌ای با عنوان %r پیدا نشد", self.window_title)
            return
        try:
            matches[0].activate()
        except Exception as exc:  # noqa: BLE001 - API پنجره روی بعضی نسخه‌ها خطا می‌دهد
            log.warning("فعال‌سازی پنجره ناموفق بود: %s", exc)

    def send(self, attempt: int) -> OrderResult:
        if self.mode == "click":
            self._gui.click(self.x, self.y)
            detail = f"کلیک روی ({self.x}, {self.y})"
        else:
            keys = self.hotkey or ["enter"]
            self._gui.hotkey(*keys)
            detail = f"کلید {'+'.join(keys)}"
        # از روی رابط گرافیکی نمی‌شود فهمید سفارش پذیرفته شد یا نه؛
        # تلاش‌های پشتیبان در این حالت خطرناکند و باید صفر باشند.
        return OrderResult(True, f"{detail} انجام شد (تأیید پذیرش از ایزی‌تریدر بگیرید)")

    def close(self) -> None:  # pragma: no cover
        pass
