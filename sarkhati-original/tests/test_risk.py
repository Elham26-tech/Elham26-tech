import unittest

from sarkhati.risk import Order, PriceRules, RiskLimits, resolve_price, validate


class PriceRulesTest(unittest.TestCase):
    def test_limits_stay_inside_band(self):
        rules = PriceRules(band_pct=3.0, tick=1)
        low, high = rules.limits(5430)
        self.assertEqual(high, 5592)  # floor(5430*1.03) = floor(5592.9)
        self.assertEqual(low, 5268)   # ceil(5430*0.97) = ceil(5267.1)
        self.assertLessEqual(high, 5430 * 1.03)
        self.assertGreaterEqual(low, 5430 * 0.97)

    def test_tick_rounding_never_exceeds_band(self):
        rules = PriceRules(band_pct=5.0, tick=10)
        low, high = rules.limits(1234)
        self.assertEqual(high % 10, 0)
        self.assertEqual(low % 10, 0)
        self.assertLessEqual(high, 1234 * 1.05)
        self.assertGreaterEqual(low, 1234 * 0.95)

    def test_rejects_non_positive_reference(self):
        with self.assertRaises(ValueError):
            PriceRules().limits(0)


class ResolvePriceTest(unittest.TestCase):
    def test_upper_band(self):
        order = Order(symbol="فولاد", side="buy", quantity=10, price_mode="upper_band", reference_price=5430)
        self.assertEqual(resolve_price(order, PriceRules()), 5592)

    def test_limit_requires_price(self):
        order = Order(symbol="فولاد", side="buy", quantity=10, price_mode="limit")
        with self.assertRaises(ValueError):
            resolve_price(order, PriceRules())


class ValidateTest(unittest.TestCase):
    def setUp(self):
        self.rules = PriceRules()
        self.limits = RiskLimits(max_order_value=100_000_000, max_quantity=1_000_000, allowed_symbols=["فولاد"])

    def _order(self, **kw):
        base = dict(symbol="فولاد", side="buy", quantity=1000, price=5500, reference_price=5430, price_mode="limit")
        base.update(kw)
        return Order(**base)

    def test_valid_order_has_no_problems(self):
        self.assertEqual(validate(self._order(), self.rules, self.limits), [])

    def test_price_outside_band_is_caught(self):
        problems = validate(self._order(price=9999), self.rules, self.limits)
        self.assertTrue(any("دامنه" in p for p in problems))

    def test_symbol_whitelist(self):
        problems = validate(self._order(symbol="خودرو"), self.rules, self.limits)
        self.assertTrue(any("فهرست مجاز" in p for p in problems))

    def test_order_value_cap(self):
        problems = validate(self._order(quantity=100_000), self.rules, self.limits)
        self.assertTrue(any("ارزش سفارش" in p for p in problems))

    def test_missing_reference_price_blocks_when_required(self):
        problems = validate(self._order(reference_price=None), self.rules, self.limits)
        self.assertTrue(any("پایانی دیروز" in p for p in problems))

    def test_bad_side_and_quantity(self):
        problems = validate(self._order(side="hold", quantity=0), self.rules, self.limits)
        self.assertEqual(len(problems), 2)
