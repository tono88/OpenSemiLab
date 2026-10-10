"""Concurrent admissions, ownership and crash recovery, without launching EDA."""
import json
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from physical_queue import PhysicalQueue, QueueError, ResourceMonitor, cpu_capacity


def wait_until(predicate, seconds=3):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        threading.Event().wait(.01)
    raise AssertionError("Queue did not reach the expected state")


class PhysicalQueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.release = threading.Event()
        self.entered = []
        self.resources = {"worker_cpu_percent": 10, "host_cpu_percent": 10, "cpu_capacity": 4,
                          "memory_available_mb": 10000, "disk_free_mb": 10000}
        def runner(job_id, payload, progress, cancel):
            self.entered.append((job_id, payload["marker"]))
            progress({"live_output": "OpenROAD routing", "cpu_percent": payload.get("cpu", 0)})
            while not self.release.wait(.01) and not cancel.is_set():
                pass
            return {"success": not cancel.is_set(), "cancelled": cancel.is_set(), "artifacts": [],
                    "output": "done", "exit_code": 130 if cancel.is_set() else 0,
                    "engine": "test", "action": "physical", "duration_ms": 10}
        self.runner = runner
        self.queues = []

    def tearDown(self):
        self.release.set()
        for q in self.queues:
            q.stop()
            def drained():
                with q.condition:
                    return not q._active()
            wait_until(drained)
        self.temp.cleanup()

    def queue(self, **kwargs):
        q = PhysicalQueue(self.root, self.runner, sample=lambda: dict(self.resources), interval=.03, **kwargs)
        self.queues.append(q)
        return q

    def test_fifo_position_and_queued_cancel_never_runs_tools(self):
        q = self.queue()
        first = q.submit({"marker": "first"}, "alice")
        q.start()
        wait_until(lambda: len(self.entered) == 1)
        second = q.submit({"marker": "cancelled"}, "bob")
        third = q.submit({"marker": "third"}, "carol")
        self.assertEqual(q.get(second["job_id"], "bob")["jobs_ahead"], 1)
        self.assertEqual(q.get(third["job_id"], "carol")["queue_position"], 3)
        self.assertEqual(q.cancel(second["job_id"], "bob")["status"], "cancelled")
        self.assertEqual(q.cancel(second["job_id"], "bob")["status"], "cancelled")
        self.assertEqual(q.get(third["job_id"], "carol")["jobs_ahead"], 1)
        self.release.set()
        wait_until(lambda: q.get(third["job_id"], "carol")["status"] == "completed")
        self.assertEqual([marker for _, marker in self.entered], ["first", "third"])
        self.assertEqual(q.get(first["job_id"], "alice")["result"]["output"], "done")

    def test_cpu_sixty_percent_means_fraction_of_four_allocated_cpus(self):
        q = self.queue(max_running=2)
        first = q.submit({"marker": "hot", "cpu": 280}, "alice")
        q.start()
        wait_until(lambda: len(self.entered) == 1)
        second = q.submit({"marker": "waiting"}, "bob")
        wait_until(lambda: q.get(second["job_id"], "bob")["queue_reason"] == "cpu_busy")
        self.assertEqual(len(self.entered), 1)
        with q.condition:
            q.jobs[first["job_id"]]["cpu_percent"] = 240  # Exactly 60% does not exceed the threshold.
            q.condition.notify_all()
        wait_until(lambda: len(self.entered) == 2)

    def test_host_load_memory_and_disk_also_hold_the_first_job(self):
        q = self.queue()
        self.resources["host_cpu_percent"] = 85
        job = q.submit({"marker": "resources"}, "alice")
        q.start()
        wait_until(lambda: q.get(job["job_id"], "alice")["queue_reason"] == "cpu_busy")
        self.assertFalse(self.entered)
        self.resources.update(host_cpu_percent=10, memory_available_mb=1000)
        wait_until(lambda: q.get(job["job_id"], "alice")["queue_reason"] == "memory_low")
        self.resources.update(memory_available_mb=10000, disk_free_mb=100)
        wait_until(lambda: q.get(job["job_id"], "alice")["queue_reason"] == "disk_low")
        self.resources["disk_free_mb"] = 10000
        wait_until(lambda: len(self.entered) == 1)

    def test_running_cancellation_releases_slot_only_after_runner_exits(self):
        exited = threading.Event()
        def delayed_exit(job_id, payload, progress, cancel):
            self.entered.append((job_id, payload["marker"]))
            cancel.wait(3)
            exited.wait(3)
            return {"success": False, "cancelled": True, "output": "partial", "artifacts": []}
        q = self.queue()
        q.runner = delayed_exit
        first = q.submit({"marker": "first"}, "alice")
        q.start()
        wait_until(lambda: len(self.entered) == 1)
        second = q.submit({"marker": "second"}, "bob")
        self.assertEqual(q.cancel(first["job_id"], "alice")["status"], "cancelling")
        self.assertEqual(q.get(second["job_id"], "bob")["jobs_ahead"], 1)
        self.assertEqual(len(self.entered), 1)
        q.runner = self.runner
        exited.set()
        wait_until(lambda: len(self.entered) == 2)

    def test_owner_checks_hide_sources_and_other_users_jobs(self):
        q = self.queue()
        own = q.submit({"marker": "secret RTL", "sources": {"rtl/top.sv": "private"}}, "alice")
        self.assertNotIn("payload", own)
        self.assertNotIn("owner_id", own)
        self.assertNotIn("private", json.dumps(own))
        self.assertEqual(q.list_owned("bob"), [])
        for operation in (q.get, q.cancel):
            with self.assertRaises(QueueError) as denied:
                operation(own["job_id"], "bob")
            self.assertEqual(denied.exception.status, 404)

    def test_idempotency_per_user_limit_and_bounded_queue(self):
        q = self.queue(max_pending=3)
        payload = {"marker": "one", "request_id": "1234567890abcdef", "project_id": "project-one"}
        first = q.submit(payload, "alice")
        self.assertEqual(q.submit(payload, "alice")["job_id"], first["job_id"])
        with self.assertRaises(QueueError):
            q.submit({**payload, "request_id": "another-request-id"}, "alice")
        q.submit({"marker": "two"}, "alice")
        with self.assertRaises(QueueError) as full_user:
            q.submit({"marker": "three"}, "alice")
        self.assertEqual(full_user.exception.status, 429)
        q.submit({"marker": "three"}, "bob")
        with self.assertRaises(QueueError) as full_queue:
            q.submit({"marker": "four"}, "carol")
        self.assertEqual(full_queue.exception.status, 429)

    def test_pending_jobs_survive_restart_cancelled_jobs_never_return(self):
        q = self.queue()
        first = q.submit({"marker": "restored"}, "alice")
        cancelled = q.submit({"marker": "never"}, "bob")
        q.cancel(cancelled["job_id"], "bob")
        restored = self.queue()
        self.assertEqual(restored.get(first["job_id"], "alice")["status"], "queued")
        self.assertEqual(restored.get(cancelled["job_id"], "bob")["status"], "cancelled")
        restored.start()
        self.release.set()
        wait_until(lambda: restored.get(first["job_id"], "alice")["status"] == "completed")
        self.assertEqual([marker for _, marker in self.entered], ["restored"])

    def test_interrupted_running_job_is_failed_not_automatically_replayed(self):
        q = self.queue()
        job = q.submit({"marker": "interrupted"}, "alice")
        with q.condition:
            q.jobs[job["job_id"]].update(status="running", started_at=time.time(), live_output="routing")
            q._save(q.jobs[job["job_id"]])
            q.jobs.clear()  # Simulate loss of process memory with durable state intact.
        recovered = self.queue()
        restored = recovered.get(job["job_id"], "alice")
        self.assertEqual(restored["status"], "failed")
        self.assertEqual(restored["result"]["exit_code"], 75)
        self.assertIn("routing", restored["result"]["output"])
        self.assertFalse(recovered.list_owned("alice"))

    def test_simultaneous_submitters_cannot_exceed_capacity_or_double_start(self):
        q = self.queue(max_pending=4)
        barrier = threading.Barrier(12)
        accepted, errors = [], []
        def submit(i):
            barrier.wait()
            try:
                accepted.append(q.submit({"marker": str(i)}, f"user{i}"))
            except QueueError as error:
                errors.append(error.status)
        threads = [threading.Thread(target=submit, args=(i,)) for i in range(12)]
        for thread in threads: thread.start()
        for thread in threads: thread.join(3)
        self.assertEqual(len(accepted), 4)
        self.assertEqual(errors, [429] * 8)
        q.start()
        self.release.set()
        wait_until(lambda: all(q.get(j["job_id"], q.jobs[j["job_id"]]["owner_id"])["status"] == "completed" for j in accepted))
        self.assertEqual(len({j for j, _ in self.entered}), 4)
        self.assertEqual([j for j, _ in self.entered], [j["job_id"] for j in sorted(accepted, key=lambda j: j["created_at"])])

    def test_failed_acceptance_write_does_not_start_or_acknowledge_job(self):
        q = self.queue()
        with patch.object(q, "_save", side_effect=OSError("disk full")):
            with self.assertRaises(OSError): q.submit({"marker": "not-accepted"}, "alice")
        self.assertFalse(q.jobs)
        self.assertFalse(self.entered)

    def test_terminal_artifacts_are_on_disk_and_retention_is_bounded(self):
        q = self.queue(retain=1)
        q.start()
        self.release.set()
        first = q.submit({"marker": "one"}, "alice")
        wait_until(lambda: q.get(first["job_id"], "alice")["status"] == "completed")
        self.assertNotIn("result", q.jobs[first["job_id"]])
        second = q.submit({"marker": "two"}, "alice")
        wait_until(lambda: q.get(second["job_id"], "alice")["status"] == "completed")
        with self.assertRaises(QueueError): q.get(first["job_id"], "alice")
        self.assertEqual(len(list(q.root.glob("*.json"))), 1)

    def test_thread_exhaustion_preserves_turn_and_retries_without_double_start(self):
        q = self.queue()
        job = q.submit({"marker": "retry"}, "alice")
        original_start = threading.Thread.start
        def limited_start(thread):
            if thread.name.startswith("physical-") and thread.name != "physical-queue":
                raise RuntimeError("can't start new thread")
            return original_start(thread)
        with patch("physical_queue.threading.Thread.start", limited_start), patch("builtins.print"):
            q.start()
            wait_until(lambda: q.get(job["job_id"], "alice")["queue_reason"] == "admission_unavailable")
            state = q.get(job["job_id"], "alice")
            self.assertEqual(state["status"], "queued")
            self.assertEqual(state["queue_position"], 1)
            self.assertEqual(state["queue"]["running"], 0)
            self.assertEqual(json.loads((q.root / f'{job["job_id"]}.json').read_text())["status"], "queued")
            self.assertFalse(self.entered)
        self.release.set()
        wait_until(lambda: q.get(job["job_id"], "alice")["status"] == "completed")
        self.assertEqual([marker for _, marker in self.entered], ["retry"])


class ResourceMonitorTests(unittest.TestCase):
    def test_cgroup_v2_quota_cpu_and_memory_are_normalized(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "cpu.max").write_text("400000 100000")
            (root / "cpu.stat").write_text("usage_usec 1000000\n")
            (root / "memory.max").write_text(str(6 * 1024**3))
            (root / "memory.current").write_text(str(2 * 1024**3))
            (root / "stat").write_text("cpu 100 0 0 100 0 0 0 0\n")
            (root / "meminfo").write_text("MemAvailable: 10000000 kB\n")
            with patch("physical_queue.os.sched_getaffinity", return_value=set(range(8))):
                self.assertEqual(cpu_capacity(root), 4)
                monitor = ResourceMonitor(root, root, root)
            with patch("physical_queue.time.monotonic", return_value=1): monitor.sample()
            (root / "cpu.stat").write_text("usage_usec 6000000\n")
            (root / "stat").write_text("cpu 180 0 0 120 0 0 0 0\n")
            with patch("physical_queue.time.monotonic", return_value=3): measured = monitor.sample()
            self.assertEqual(measured["worker_cpu_percent"], 62.5)
            self.assertEqual(measured["host_cpu_percent"], 80)
            self.assertEqual(measured["memory_available_mb"], 4096)

    def test_cgroup_v1_and_fractional_cpu_quota(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "cpu").mkdir()
            (root / "cpu/cpu.cfs_quota_us").write_text("50000")
            (root / "cpu/cpu.cfs_period_us").write_text("100000")
            with patch("physical_queue.os.sched_getaffinity", return_value=set(range(8))):
                self.assertEqual(cpu_capacity(root), .5)


if __name__ == "__main__":
    unittest.main()
