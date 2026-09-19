import time
import unittest

from sarkhati.scheduler import FirePlan, precise_wait, run_plan
from sarkhati.timesync import ClockOffset


class PreciseWaitTest(unittest.TestCase):
    def test_hits_deadline_within_two_milliseconds(self):
        target = time.time() + 0.12
        error = precise_wait(target)
        self.assertGreaterEqual(error, 0)
        self.assertLess(error, 0.002, f"خطای زمانی {error * 1000:.2f}ms بیش از حد است")

    def test_past_deadline_returns_immediately(self):
        started = time.perf_counter()
        precise_wait(time.time() - 1)
        self.assertLess(time.perf_counter() - started, 0.01)


class FirePlanTest(unittest.TestCase):
    def test_attempt_times_apply_lead_and_gap(self):
        plan = FirePlan(target_server_epoch=1000.0, lead_time=0.02, retries=2, retry_gap=0.05)
        self.assertEqual(plan.attempt_times(), [999.98, 1000.03, 1000.08])

    def test_no_retries_gives_single_attempt(self):
        plan = FirePlan(target_server_epoch=1000.0, retries=0)
        self.assertEqual(len(plan.attempt_times()), 1)


class RunPlanTest(unittest.TestCase):
    def test_stops_on_first_acceptance(self):
        calls = []
        plan = FirePlan(target_server_epoch=time.time() + 0.05, retries=3, retry_gap=0.01)
        records = run_plan(plan, ClockOffset(), lambda i: (calls.append(i) or (True, "ok")))
        self.assertEqual(calls, [0])
        self.assertEqual(len(records), 1)
        self.assertTrue(records[0].accepted)

    def test_retries_until_exhausted(self):
        plan = FirePlan(target_server_epoch=time.time() + 0.02, retries=2, retry_gap=0.01)
        records = run_plan(plan, ClockOffset(), lambda i: (False, "رد"))
        self.assertEqual(len(records), 3)
        self.assertFalse(any(r.accepted for r in records))

    def test_timing_error_is_small(self):
        plan = FirePlan(target_server_epoch=time.time() + 0.15, retries=0)
        records = run_plan(plan, ClockOffset(), lambda i: (True, "ok"))
        self.assertLess(abs(records[0].timing_error), 0.005)
