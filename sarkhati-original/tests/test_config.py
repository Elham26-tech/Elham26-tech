import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from sarkhati.config import AppConfig, ScheduleConfig, parse_clock_time, tehran_tz

SAMPLE = {
    "schedule": {"target_time": "08:30:00.250", "date": "2026-03-10", "timezone": "Asia/Tehran"},
    "order": {
        "symbol": "فولاد",
        "side": "buy",
        "quantity": 500,
        "price_mode": "upper_band",
        "reference_price": 5430,
    },
    "risk": {"band_pct": 3.0, "tick": 1, "max_order_value": 50_000_000, "allowed_symbols": ["فولاد"]},
    "broker": {"name": "dryrun", "settings": {"base_url": "https://api.example.com"}},
}


class ParseTimeTest(unittest.TestCase):
    def test_parses_milliseconds(self):
        parsed = parse_clock_time("08:30:00.250")
        self.assertEqual((parsed.hour, parsed.minute, parsed.microsecond), (8, 30, 250_000))

    def test_parses_without_seconds(self):
        self.assertEqual(parse_clock_time("8:30").minute, 30)

    def test_rejects_garbage(self):
        with self.assertRaises(ValueError):
            parse_clock_time("۸ و نیم")


class ScheduleTest(unittest.TestCase):
    def test_explicit_date_target(self):
        schedule = ScheduleConfig(target_time="08:30:00.000", date="2026-03-10")
        target = datetime.fromtimestamp(schedule.target_epoch(), tehran_tz())
        self.assertEqual((target.hour, target.minute), (8, 30))
        self.assertEqual(target.date().isoformat(), "2026-03-10")

    def test_next_rolls_to_tomorrow_when_past(self):
        tz = tehran_tz()
        now = datetime.now(tz)
        past = (now - timedelta(minutes=5)).strftime("%H:%M:%S")
        schedule = ScheduleConfig(target_time=past, date="next")
        self.assertGreater(schedule.target_epoch(now=now), now.timestamp())


class LoadTest(unittest.TestCase):
    def test_round_trip_from_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(json.dumps(SAMPLE, ensure_ascii=False), encoding="utf-8")
            config = AppConfig.load(path)
        self.assertEqual(config.order.symbol, "فولاد")
        self.assertEqual(config.order.quantity, 500)
        self.assertEqual(config.risk.max_order_value, 50_000_000)
        self.assertEqual(config.price_rules.band_pct, 3.0)
        # http_url خالی باید از base_url کارگزار پر شود
        self.assertEqual(config.clock.http_url, "https://api.example.com")

    def test_unknown_keys_are_ignored(self):
        data = dict(SAMPLE)
        data["order"] = dict(SAMPLE["order"], nonsense=1)
        config = AppConfig.from_dict(data)
        self.assertEqual(config.order.symbol, "فولاد")
