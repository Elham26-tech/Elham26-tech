"""پیاده‌سازی‌های ارسال سفارش."""

from .base import Broker, OrderResult
from .dryrun import DryRunBroker
from .easytrader import EasyTraderBroker, HttpBrokerConfig

__all__ = [
    "Broker",
    "OrderResult",
    "DryRunBroker",
    "EasyTraderBroker",
    "HttpBrokerConfig",
    "build_broker",
]


def build_broker(name: str, settings: dict, *, live: bool):
    """کارگزار را از روی نام می‌سازد. در حالت غیرزنده همیشه شبیه‌ساز برمی‌گردد."""
    if not live:
        return DryRunBroker(name=name)
    if name in ("easytrader", "mofid", "http"):
        return EasyTraderBroker(HttpBrokerConfig.from_dict(settings))
    if name == "desktop":
        from .desktop import DesktopBroker  # وابستگی اختیاری

        return DesktopBroker.from_dict(settings)
    if name == "dryrun":
        return DryRunBroker(name=name)
    raise ValueError(f"کارگزار ناشناخته: {name}")
