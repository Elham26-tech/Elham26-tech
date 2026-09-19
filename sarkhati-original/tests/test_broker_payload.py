import json
import unittest

from sarkhati.brokers.easytrader import EasyTraderBroker, HttpBrokerConfig
from sarkhati.risk import Order


class PayloadTest(unittest.TestCase):
    def setUp(self):
        self.config = HttpBrokerConfig(
            base_url="https://api.example.com",
            order_path="/orders",
            payload_template={
                "isin": "{isin}",
                "quantity": "{quantity}",
                "price": "{price}",
                "side": "{side}",
                "note": "سرخطی {symbol}",
            },
        )
        self.broker = EasyTraderBroker(self.config)
        self.order = Order(symbol="فولاد", isin="IRO1FOLD0001", side="buy", quantity=1000)

    def test_numeric_placeholders_keep_their_type(self):
        payload = self.broker.build_payload(self.order, 5592)
        self.assertEqual(payload["price"], 5592)
        self.assertEqual(payload["quantity"], 1000)
        self.assertEqual(payload["side"], 1)
        self.assertIsInstance(payload["price"], int)

    def test_text_placeholders_are_interpolated(self):
        payload = self.broker.build_payload(self.order, 5592)
        self.assertEqual(payload["isin"], "IRO1FOLD0001")
        self.assertEqual(payload["note"], "سرخطی فولاد")

    def test_unknown_placeholder_raises(self):
        self.config.payload_template = {"x": "{bogus}"}
        with self.assertRaises(ValueError):
            self.broker.build_payload(self.order, 1)

    def test_request_bytes_are_complete(self):
        raw = self.broker._build_request(self.broker.build_payload(self.order, 5592))
        head, _, body = raw.partition(b"\r\n\r\n")
        text = head.decode()
        self.assertTrue(text.startswith("POST /orders HTTP/1.1"))
        self.assertIn("Host: api.example.com", text)
        self.assertIn(f"Content-Length: {len(body)}", text)
        self.assertEqual(json.loads(body)["price"], 5592)

    def test_response_interpretation(self):
        self.config.success_markers = ['"isSuccessful":true']
        ok = self.broker._interpret('HTTP/1.1 200 OK\r\n\r\n{"isSuccessful":true}')
        self.assertTrue(ok.accepted)
        soft_fail = self.broker._interpret('HTTP/1.1 200 OK\r\n\r\n{"isSuccessful":false}')
        self.assertFalse(soft_fail.accepted)
        hard_fail = self.broker._interpret("HTTP/1.1 401 Unauthorized\r\n\r\nno")
        self.assertFalse(hard_fail.accepted)
