"""ارسال سفارش از طریق API وب ایزی‌تریدر مفید (یا هر OMS مبتنی بر HTTP).

نکتهٔ مهم: شکل دقیق درخواستِ ایزی‌تریدر عمومی و مستند نیست و کارگزار هر
چند وقت آن را تغییر می‌دهد. به همین دلیل این کلاس «قالب‌محور» است: مسیر،
هدرها و بدنهٔ درخواست از فایل پیکربندی می‌آید. یک‌بار درخواست ثبت سفارش را
از Network tab مرورگر (یا کلاینت خودتان) کپی کنید، در ``config.yaml``
بگذارید و از آن به بعد تنها چیزی که این کد اضافه می‌کند دقتِ زمانی است.

بهینه‌سازی‌های تأخیر (همه *قبل از* لحظهٔ شلیک انجام می‌شوند):

* حل DNS، اتصال TCP و دست‌دادن TLS در ``prepare``.
* گرم‌کردن مسیر با یک درخواست بی‌ضرر تا پنجرهٔ ازدحام TCP باز شود.
* سریال‌سازی کامل بایت‌های درخواست، تا ``send`` فقط یک ``sendall`` باشد.
* ``TCP_NODELAY`` برای حذف تأخیر الگوریتم Nagle.
* چند اتصال موازی، تا اگر یکی کند شد تلاش بعدی روی اتصال دیگری برود.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import ssl
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

from ..risk import Order
from .base import OrderResult

log = logging.getLogger(__name__)

DEFAULT_HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Connection": "keep-alive",
}


@dataclass
class HttpBrokerConfig:
    base_url: str = "https://api.emofid.com"
    order_path: str = "/easy/api/OmsOrder/Post"
    warmup_path: str = "/"
    method: str = "POST"
    headers: dict[str, str] = field(default_factory=dict)
    token_env: str = "SARKHATI_TOKEN"
    """نام متغیر محیطی حاوی توکن. توکن هرگز داخل فایل پیکربندی نوشته نشود."""

    token_header: str = "Authorization"
    token_prefix: str = "Bearer "
    payload_template: dict[str, Any] = field(default_factory=dict)
    """قالب بدنه؛ رشته‌ها با {symbol} {isin} {price} {quantity} {side} پر می‌شوند."""

    side_values: dict[str, Any] = field(default_factory=lambda: {"buy": 1, "sell": 2})
    connections: int = 2
    response_timeout: float = 3.0
    connect_timeout: float = 5.0
    success_markers: list[str] = field(default_factory=lambda: ["isSuccessful\":true", "\"succeeded\":true"])
    failure_markers: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "HttpBrokerConfig":
        known = {f for f in cls.__dataclass_fields__}
        unknown = set(data) - known
        if unknown:
            log.warning("کلیدهای ناشناخته در تنظیمات کارگزار نادیده گرفته شد: %s", ", ".join(sorted(unknown)))
        return cls(**{k: v for k, v in data.items() if k in known})

    @property
    def host(self) -> str:
        host = urlsplit(self.base_url).hostname
        if not host:
            raise ValueError(f"base_url نامعتبر است: {self.base_url}")
        return host

    @property
    def port(self) -> int:
        parts = urlsplit(self.base_url)
        return parts.port or (80 if parts.scheme == "http" else 443)

    @property
    def use_tls(self) -> bool:
        return urlsplit(self.base_url).scheme != "http"


def _fill(value: Any, values: dict[str, Any]) -> Any:
    if isinstance(value, str):
        try:
            filled = value.format(**values)
        except KeyError as exc:
            raise ValueError(f"جای‌نگهدار ناشناخته در قالب بدنه: {exc}") from exc
        # اگر کل رشته یک جای‌نگهدار عددی بود، نوع عددی حفظ شود.
        if value.startswith("{") and value.endswith("}") and value.count("{") == 1:
            key = value[1:-1]
            if key in values:
                return values[key]
        return filled
    if isinstance(value, dict):
        return {k: _fill(v, values) for k, v in value.items()}
    if isinstance(value, list):
        return [_fill(v, values) for v in value]
    return value


class EasyTraderBroker:
    name = "easytrader"

    def __init__(self, config: HttpBrokerConfig) -> None:
        self.config = config
        self._request: bytes = b""
        self._sockets: list[ssl.SSLSocket | socket.socket] = []

    # ------------------------------------------------------------ آماده‌سازی

    def build_payload(self, order: Order, price: int) -> dict[str, Any]:
        template = self.config.payload_template or {
            "isin": "{isin}",
            "symbol": "{symbol}",
            "quantity": "{quantity}",
            "price": "{price}",
            "side": "{side}",
            "validity": "{validity}",
        }
        values = {
            "symbol": order.symbol,
            "isin": order.isin or order.symbol,
            "price": int(price),
            "quantity": int(order.quantity),
            "side": self.config.side_values.get(order.side, order.side),
            "validity": order.validity,
        }
        return _fill(template, values)

    def _build_request(self, payload: dict[str, Any]) -> bytes:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers = dict(DEFAULT_HEADERS)
        headers.update(self.config.headers)
        token = os.environ.get(self.config.token_env, "")
        if token:
            headers[self.config.token_header] = f"{self.config.token_prefix}{token}"
        else:
            log.warning(
                "متغیر محیطی %s خالی است؛ درخواست بدون توکن احراز هویت می‌رود",
                self.config.token_env,
            )
        headers["Host"] = self.config.host
        headers["Content-Length"] = str(len(body))
        head = f"{self.config.method} {self.config.order_path} HTTP/1.1\r\n"
        head += "".join(f"{k}: {v}\r\n" for k, v in headers.items())
        return head.encode("utf-8") + b"\r\n" + body

    def _connect(self) -> ssl.SSLSocket | socket.socket:
        raw = socket.create_connection(
            (self.config.host, self.config.port), timeout=self.config.connect_timeout
        )
        raw.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        if not self.config.use_tls:
            raw.settimeout(self.config.response_timeout)
            return raw
        context = ssl.create_default_context()
        sock = context.wrap_socket(raw, server_hostname=self.config.host)
        sock.settimeout(self.config.response_timeout)
        return sock

    def _warmup(self, sock: ssl.SSLSocket | socket.socket) -> None:
        """یک درخواست بی‌ضرر تا مسیر شبکه و کش‌های میانی گرم شوند."""
        req = (
            f"HEAD {self.config.warmup_path} HTTP/1.1\r\n"
            f"Host: {self.config.host}\r\n"
            "Connection: keep-alive\r\n\r\n"
        ).encode()
        try:
            sock.sendall(req)
            self._read_response(sock, head_only=True)
        except OSError as exc:
            log.debug("گرم‌کردن اتصال ناموفق بود: %s", exc)

    def prepare(self, order: Order, price: int) -> None:
        payload = self.build_payload(order, price)
        self._request = self._build_request(payload)
        log.info("بدنهٔ سفارش آماده شد (%d بایت)", len(self._request))
        self.close()
        for i in range(max(1, self.config.connections)):
            try:
                sock = self._connect()
            except OSError as exc:
                log.error("اتصال %d برقرار نشد: %s", i + 1, exc)
                continue
            self._warmup(sock)
            self._sockets.append(sock)
        if not self._sockets:
            raise ConnectionError(f"هیچ اتصالی به {self.config.host} برقرار نشد")
        log.info("%d اتصال گرم و آماده است", len(self._sockets))

    def keepalive(self) -> None:
        """اتصال‌های گرم را زنده نگه می‌دارد تا لحظهٔ شلیک صرف دست‌دادن TLS نشود."""
        for index, sock in enumerate(list(self._sockets)):
            try:
                self._warmup(sock)
            except OSError as exc:
                log.info("اتصال %d مرد (%s)؛ جایگزین می‌شود", index + 1, exc)
                try:
                    sock.close()
                except OSError:
                    pass
                try:
                    self._sockets[index] = self._connect()
                    self._warmup(self._sockets[index])
                except OSError as exc2:
                    log.warning("اتصال جایگزین برقرار نشد: %s", exc2)

    # ---------------------------------------------------------------- ارسال

    def send(self, attempt: int) -> OrderResult:
        if not self._request:
            raise RuntimeError("prepare() قبل از send() فراخوانی نشده است")
        index = attempt % len(self._sockets)
        sock = self._sockets[index]
        try:
            sock.sendall(self._request)
            raw = self._read_response(sock)
        except OSError as exc:
            log.warning("اتصال %d قطع شد (%s)؛ اتصال تازه و ارسال مجدد", index + 1, exc)
            try:
                sock.close()
            except OSError:
                pass
            try:
                sock = self._connect()
                self._sockets[index] = sock
                sock.sendall(self._request)
                raw = self._read_response(sock)
            except OSError as exc2:
                return OrderResult(False, f"ارسال ناموفق: {exc2}")
        return self._interpret(raw)

    def _read_response(self, sock, head_only: bool = False) -> str:
        deadline = time.perf_counter() + self.config.response_timeout
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = sock.recv(4096)
            if not chunk:
                raise OSError("اتصال از سمت سرور بسته شد")
            buf += chunk
            if time.perf_counter() > deadline:
                raise OSError("مهلت خواندن پاسخ تمام شد")
        header_blob, _, body = buf.partition(b"\r\n\r\n")
        headers = header_blob.decode("latin-1")
        if head_only:
            return headers
        length = _content_length(headers)
        if length is not None:
            while len(body) < length:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                body += chunk
                if time.perf_counter() > deadline:
                    break
        elif "chunked" in headers.lower():
            while not body.rstrip().endswith(b"0"):
                chunk = sock.recv(4096)
                if not chunk:
                    break
                body += chunk
                if time.perf_counter() > deadline:
                    break
        return headers + "\r\n\r\n" + body.decode("utf-8", errors="replace")

    def _interpret(self, raw: str) -> OrderResult:
        status_line = raw.split("\r\n", 1)[0]
        parts = status_line.split()
        status = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
        body = raw.partition("\r\n\r\n")[2]
        lowered = raw.lower()
        for marker in self.config.failure_markers:
            if marker.lower() in lowered:
                return OrderResult(False, f"پاسخ حاوی نشانهٔ خطا ({marker})", raw=body)
        if self.config.success_markers:
            for marker in self.config.success_markers:
                if marker.lower() in lowered:
                    return OrderResult(True, f"سفارش پذیرفته شد (HTTP {status})", raw=body)
            if 200 <= status < 300:
                return OrderResult(
                    False,
                    f"HTTP {status} ولی نشانهٔ موفقیت در پاسخ نبود",
                    raw=body,
                )
        elif 200 <= status < 300:
            return OrderResult(True, f"سفارش پذیرفته شد (HTTP {status})", raw=body)
        return OrderResult(False, f"HTTP {status}: {body[:200]}", raw=body)

    def close(self) -> None:
        for sock in self._sockets:
            try:
                sock.close()
            except OSError:
                pass
        self._sockets = []


def _content_length(headers: str) -> int | None:
    for line in headers.split("\r\n"):
        if line.lower().startswith("content-length:"):
            try:
                return int(line.split(":", 1)[1].strip())
            except ValueError:
                return None
    return None
