"""همگام‌سازی ساعت با دقت میلی‌ثانیه.

دقت «سرخطی» عملاً یعنی دقت تخمین ما از ساعت سرور کارگزار. سه منبع داریم:

1. SNTP روی UDP (ntp.sharif.edu، pool.ntp.org): دقت خوب نسبت به UTC ولی
   ساعت سرور کارگزار ممکن است چند ده میلی‌ثانیه با UTC اختلاف داشته باشد.
2. لبه‌یابی هدر ``Date`` در پاسخ HTTP خودِ کارگزار: هدر فقط دقت ثانیه دارد،
   اما با نمونه‌برداری پشت‌سرهم و پیدا کردن لحظهٔ «پرش ثانیه» می‌توان مرز
   ثانیهٔ سرور را با خطای چند میلی‌ثانیه پیدا کرد. این دقیق‌ترین منبعی است
   که بدون API زمان اختصاصی در دسترس است.
3. ساعت محلی (پیش‌فرض، بدون تصحیح).

خروجی همهٔ منابع یک ``ClockOffset`` است که روی ``time.monotonic`` لنگر
می‌اندازد تا پرش‌های ساعت سیستم (NTP daemon محلی) نتیجه را خراب نکند.
"""

from __future__ import annotations

import http.client
import logging
import socket
import statistics
import struct
import time
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from typing import Callable, Iterable, Sequence
from urllib.parse import urlsplit

log = logging.getLogger(__name__)

# مبدأ NTP (۱۹۰۰) تا مبدأ یونیکس (۱۹۷۰) بر حسب ثانیه.
_NTP_UNIX_DELTA = 2_208_988_800


@dataclass(frozen=True)
class Sample:
    """یک نمونهٔ اندازه‌گیری اختلاف ساعت."""

    offset: float
    """اختلاف به ثانیه: ``server_time - local_time`` در لحظهٔ نمونه."""

    rtt: float
    """زمان رفت‌وبرگشت به ثانیه. هرچه کمتر، نمونه معتبرتر."""

    monotonic: float
    """مقدار ``time.monotonic()`` در لحظهٔ نمونه."""

    source: str


@dataclass
class ClockOffset:
    """ساعت تصحیح‌شده: تخمین ساعت سرور بر اساس ساعت یکنواخت محلی."""

    offset: float = 0.0
    uncertainty: float = 0.0
    drift: float = 0.0
    """رانش بر حسب ثانیه بر ثانیه (معمولاً کمتر از 1e-5)."""

    anchor_monotonic: float = field(default_factory=time.monotonic)
    source: str = "local"
    samples: int = 0

    def now(self) -> float:
        """زمان تخمینیِ سرور بر حسب epoch ثانیه (اعشاری)."""
        mono = time.monotonic()
        elapsed = mono - self.anchor_monotonic
        return time.time() + self.offset + self.drift * elapsed

    def local_deadline(self, server_epoch: float) -> float:
        """زمان محلی (epoch) که در آن ساعت سرور برابر ``server_epoch`` می‌شود."""
        elapsed = time.monotonic() - self.anchor_monotonic
        return server_epoch - self.offset - self.drift * elapsed

    def describe(self) -> str:
        return (
            f"منبع={self.source} اختلاف={self.offset * 1000:+.1f}ms "
            f"عدم‌قطعیت=±{self.uncertainty * 1000:.1f}ms نمونه‌ها={self.samples}"
        )


def _reduce(samples: Sequence[Sample], source: str) -> ClockOffset:
    """فیلتر کمینه‌تأخیر: نمونه‌هایی با کمترین RTT کم‌ترین خطا را دارند."""
    if not samples:
        return ClockOffset(source=f"{source}:بدون‌نمونه")
    ordered = sorted(samples, key=lambda s: s.rtt)
    best = ordered[: max(1, len(ordered) // 3)]
    offsets = [s.offset for s in best]
    offset = statistics.median(offsets)
    # عدم‌قطعیت: نیمی از RTT بهترین نمونه به‌علاوهٔ پراکندگی نمونه‌های برگزیده.
    spread = (max(offsets) - min(offsets)) / 2 if len(offsets) > 1 else 0.0
    uncertainty = best[0].rtt / 2 + spread
    return ClockOffset(
        offset=offset,
        uncertainty=uncertainty,
        anchor_monotonic=time.monotonic(),
        source=source,
        samples=len(samples),
    )


# ---------------------------------------------------------------- SNTP


def ntp_samples(server: str, count: int = 4, timeout: float = 2.0) -> list[Sample]:
    """چند نمونهٔ SNTP از یک سرور می‌گیرد. خطاها را بلع می‌کند و لیست می‌دهد."""
    out: list[Sample] = []
    packet = b"\x1b" + 47 * b"\0"  # LI=0, VN=3, Mode=3 (client)
    for _ in range(count):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(timeout)
        try:
            t0 = time.time()
            mono0 = time.monotonic()
            sock.sendto(packet, (server, 123))
            data, _ = sock.recvfrom(48)
            t3 = time.time()
            mono3 = time.monotonic()
        except OSError as exc:
            log.debug("نمونهٔ NTP از %s ناموفق: %s", server, exc)
            continue
        finally:
            sock.close()
        if len(data) < 48:
            continue
        recv_i, recv_f, tx_i, tx_f = struct.unpack("!4I", data[32:48])
        t1 = recv_i - _NTP_UNIX_DELTA + recv_f / 2**32
        t2 = tx_i - _NTP_UNIX_DELTA + tx_f / 2**32
        rtt = (t3 - t0) - (t2 - t1)
        offset = ((t1 - t0) + (t2 - t3)) / 2
        out.append(Sample(offset=offset, rtt=max(rtt, 0.0), monotonic=mono3, source=f"ntp:{server}"))
        time.sleep(0.05)
    return out


def sync_ntp(servers: Iterable[str], count: int = 4, timeout: float = 2.0) -> ClockOffset:
    samples: list[Sample] = []
    used: list[str] = []
    for server in servers:
        got = ntp_samples(server, count=count, timeout=timeout)
        if got:
            used.append(server)
        samples.extend(got)
    return _reduce(samples, f"ntp({','.join(used) or 'ناموفق'})")


# ------------------------------------------------------- HTTP Date edge


def _http_date_probe(host: str, port: int, path: str, use_tls: bool, timeout: float):
    """یک درخواست HEAD می‌زند و (زمان_سرور_ثانیه_صحیح، t_ارسال، t_دریافت) می‌دهد."""
    conn_cls = http.client.HTTPSConnection if use_tls else http.client.HTTPConnection
    conn = conn_cls(host, port, timeout=timeout)
    try:
        t0 = time.time()
        conn.request("HEAD", path, headers={"Cache-Control": "no-cache", "Pragma": "no-cache"})
        resp = conn.getresponse()
        resp.read()
        t1 = time.time()
    finally:
        conn.close()
    raw = resp.getheader("Date")
    if not raw:
        raise RuntimeError("پاسخ سرور هدر Date ندارد")
    server_second = parsedate_to_datetime(raw).timestamp()
    return server_second, t0, t1


def sync_http_date(
    url: str,
    probes: int = 40,
    timeout: float = 5.0,
    probe_fn: Callable[..., tuple[float, float, float]] | None = None,
) -> ClockOffset:
    """با لبه‌یابی هدر ``Date`` اختلاف ساعت را تا حد چند میلی‌ثانیه تخمین می‌زند.

    ایده: هدر ``Date`` فقط ثانیه را می‌دهد، ولی لحظه‌ای که مقدارش یک واحد
    می‌پرد، مرز ثانیهٔ سرور است. با نمونه‌برداری پیوسته و نگه‌داشتن کوچک‌ترین
    بازهٔ زمانی که پرش در آن رخ داده، مرز ثانیه را محاصره می‌کنیم.
    """
    parts = urlsplit(url)
    host = parts.hostname
    if not host:
        raise ValueError(f"نشانی نامعتبر: {url}")
    use_tls = parts.scheme != "http"
    port = parts.port or (443 if use_tls else 80)
    path = parts.path or "/"
    probe = probe_fn or (lambda: _http_date_probe(host, port, path, use_tls, timeout))

    prev: tuple[float, float] | None = None  # (ثانیهٔ سرور، زمان محلیِ رسیدن پاسخ)
    # بهترین محاصرهٔ لبه: (کران پایین محلی، کران بالا محلی، ثانیهٔ سرور بعد از پرش)
    best: tuple[float, float, float] | None = None
    rtts: list[float] = []

    for _ in range(probes):
        try:
            server_second, t0, t1 = probe()
        except Exception as exc:  # noqa: BLE001 - هر خطای شبکه‌ای را رد می‌کنیم
            log.debug("کاوش Date ناموفق: %s", exc)
            continue
        rtts.append(t1 - t0)
        if prev is not None:
            prev_second, prev_t1 = prev
            if server_second > prev_second:
                lower, upper = prev_t1, t0  # لبه حتماً در این بازه بوده
                if best is None or (upper - lower) < (best[1] - best[0]):
                    best = (lower, upper, server_second)
        prev = (server_second, t1)
        if best is not None and (best[1] - best[0]) < 0.010:
            break

    if best is None:
        raise RuntimeError("لبهٔ ثانیه پیدا نشد؛ تعداد کاوش را بیشتر کنید")

    lower, upper, server_second = best
    local_at_edge = (lower + upper) / 2
    offset = server_second - local_at_edge
    uncertainty = (upper - lower) / 2
    clock = ClockOffset(
        offset=offset,
        uncertainty=uncertainty,
        anchor_monotonic=time.monotonic(),
        source=f"http-date({host})",
        samples=len(rtts),
    )
    log.debug("لبهٔ ثانیه در بازهٔ %.4f ثانیه محاصره شد", upper - lower)
    return clock


def estimate_rtt(url: str, probes: int = 8, timeout: float = 5.0) -> list[float]:
    """زمان رفت‌وبرگشت HTTP را برای تصحیح تأخیر ارسال اندازه می‌گیرد."""
    parts = urlsplit(url)
    host = parts.hostname
    if not host:
        raise ValueError(f"نشانی نامعتبر: {url}")
    use_tls = parts.scheme != "http"
    port = parts.port or (443 if use_tls else 80)
    path = parts.path or "/"
    out: list[float] = []
    for _ in range(probes):
        try:
            _, t0, t1 = _http_date_probe(host, port, path, use_tls, timeout)
        except Exception as exc:  # noqa: BLE001
            log.debug("اندازه‌گیری RTT ناموفق: %s", exc)
            continue
        out.append(t1 - t0)
    return out


def sync(
    *,
    method: str = "auto",
    ntp_servers: Sequence[str] = ("ntp.sharif.edu", "pool.ntp.org", "time.google.com"),
    http_url: str | None = None,
) -> ClockOffset:
    """ساعت را با بهترین منبع در دسترس همگام می‌کند.

    ``auto`` اول هدر Date کارگزار را امتحان می‌کند (چون ساعتِ مرجع واقعی
    برای پذیرش سفارش همان است) و در صورت شکست به NTP برمی‌گردد.
    """
    if method in ("auto", "http") and http_url:
        try:
            clock = sync_http_date(http_url)
            if clock.uncertainty <= 0.050:
                return clock
            log.warning("دقت لبه‌یابی HTTP پایین بود (%s)؛ NTP امتحان می‌شود", clock.describe())
        except Exception as exc:  # noqa: BLE001
            log.warning("همگام‌سازی با هدر Date ناموفق بود: %s", exc)
        if method == "http":
            raise RuntimeError("همگام‌سازی HTTP ناموفق بود")
    if method in ("auto", "ntp"):
        clock = sync_ntp(ntp_servers)
        if clock.samples:
            return clock
        if method == "ntp":
            raise RuntimeError("هیچ سرور NTP پاسخ نداد")
    if method == "local":
        return ClockOffset(source="local")
    log.warning("هیچ منبع زمانی در دسترس نبود؛ ساعت محلی استفاده می‌شود")
    return ClockOffset(source="local(fallback)")
