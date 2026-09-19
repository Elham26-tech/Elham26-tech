import time
import unittest

from sarkhati.timesync import ClockOffset, Sample, _reduce, sync_http_date


class ClockOffsetTest(unittest.TestCase):
    def test_now_applies_offset(self):
        clock = ClockOffset(offset=1.5)
        self.assertAlmostEqual(clock.now() - time.time(), 1.5, places=2)

    def test_local_deadline_is_inverse_of_now(self):
        clock = ClockOffset(offset=-0.25)
        target = clock.now() + 10
        self.assertAlmostEqual(clock.local_deadline(target) - time.time(), 10, places=2)

    def test_drift_is_applied_over_elapsed_time(self):
        clock = ClockOffset(offset=0.0, drift=1e-3, anchor_monotonic=time.monotonic() - 100)
        self.assertAlmostEqual(clock.now() - time.time(), 0.1, places=3)


class ReduceTest(unittest.TestCase):
    def test_prefers_low_rtt_samples(self):
        samples = [
            Sample(offset=5.0, rtt=1.0, monotonic=0, source="s"),
            Sample(offset=5.0, rtt=0.9, monotonic=0, source="s"),
            Sample(offset=0.10, rtt=0.01, monotonic=0, source="s"),
        ]
        clock = _reduce(samples, "test")
        self.assertAlmostEqual(clock.offset, 0.10, places=3)
        self.assertEqual(clock.samples, 3)

    def test_empty_samples_fall_back_to_local(self):
        clock = _reduce([], "test")
        self.assertEqual(clock.offset, 0.0)
        self.assertEqual(clock.samples, 0)


class HttpDateEdgeTest(unittest.TestCase):
    """سروری شبیه‌سازی می‌کنیم که ساعتش دقیقاً ۲ ثانیه از ما جلوتر است."""

    def _probe_factory(self, offset=2.0, step=0.004, rtt=0.006):
        state = {"t": time.time()}

        def probe():
            t0 = state["t"]
            t1 = t0 + rtt
            state["t"] = t1 + step
            server_second = float(int(t0 + rtt / 2 + offset))
            return server_second, t0, t1

        return probe

    def test_edge_detection_recovers_offset(self):
        clock = sync_http_date("https://example.invalid/", probes=800, probe_fn=self._probe_factory())
        self.assertAlmostEqual(clock.offset, 2.0, delta=0.02)
        self.assertLess(clock.uncertainty, 0.020)

    def test_raises_when_no_edge_seen(self):
        frozen = lambda: (1_700_000_000.0, time.time(), time.time() + 0.001)  # noqa: E731
        with self.assertRaises(RuntimeError):
            sync_http_date("https://example.invalid/", probes=5, probe_fn=frozen)
