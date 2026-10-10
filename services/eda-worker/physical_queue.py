"""Durable FIFO admission for heavy RTL-to-GDSII jobs (one worker process).

The Docker CPU/RAM limits remain the hard safety boundary. Admission uses
measured cgroup/host load, while a concurrency cap protects against quiet
stages that can suddenly become expensive. Source bundles never leave the
internal worker; public snapshots contain only the authenticated user's job.
"""
from __future__ import annotations

import json
import os
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

ACTIVE = {"queued", "running", "cancelling"}
TERMINAL = {"completed", "failed", "cancelled"}


class QueueError(Exception):
    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


def read_number(path: Path) -> int | None:
    try:
        return int(path.read_text().strip())
    except (OSError, ValueError):
        return None


def cpu_capacity(cgroup: Path = Path("/sys/fs/cgroup")) -> float:
    """CPU equivalents, respecting affinity and Docker v2/v1 quotas."""
    try:
        capacity = float(len(os.sched_getaffinity(0)))
    except AttributeError:
        capacity = float(os.cpu_count() or 1)
    try:
        quota, period = (cgroup / "cpu.max").read_text().split()
        if quota != "max" and int(period) > 0:
            capacity = min(capacity, int(quota) / int(period))
    except (OSError, ValueError):
        quota = read_number(cgroup / "cpu/cpu.cfs_quota_us")
        period = read_number(cgroup / "cpu/cpu.cfs_period_us")
        if quota is not None and quota > 0 and period and period > 0:
            capacity = min(capacity, quota / period)
    return max(0.01, capacity)


class ResourceMonitor:
    def __init__(self, root: Path, cgroup: Path = Path("/sys/fs/cgroup"), proc: Path = Path("/proc")):
        self.root, self.cgroup, self.proc = root, cgroup, proc
        self.capacity = cpu_capacity(cgroup)
        self.previous: tuple[float, int | None, tuple[int, int] | None] | None = None

    def sample(self) -> dict[str, Any]:
        now = time.monotonic()
        usage = None
        try:
            counters = dict(line.split() for line in (self.cgroup / "cpu.stat").read_text().splitlines())
            usage = int(counters["usage_usec"])
        except (OSError, ValueError, KeyError):
            value = read_number(self.cgroup / "cpuacct/cpuacct.usage")
            if value is not None:
                usage = value // 1000
        host = None
        try:
            fields = [int(v) for v in (self.proc / "stat").read_text().splitlines()[0].split()[1:9]]
            host = (sum(fields), fields[3] + fields[4])
        except (OSError, ValueError, IndexError):
            pass
        worker_cpu = host_cpu = None
        if self.previous:
            previous_at, previous_usage, previous_host = self.previous
            interval = now - previous_at
            if interval > 0 and usage is not None and previous_usage is not None:
                worker_cpu = min(100.0, max(0.0, (usage - previous_usage) / 1e6 / interval / self.capacity * 100))
            if host and previous_host and host[0] > previous_host[0]:
                host_cpu = min(100.0, max(0.0, (1 - (host[1] - previous_host[1]) / (host[0] - previous_host[0])) * 100))
        self.previous = (now, usage, host)
        available = None
        try:
            meminfo = dict((line.split(":", 1)[0], int(line.split()[1])) for line in (self.proc / "meminfo").read_text().splitlines())
            available = meminfo["MemAvailable"] // 1024
        except (OSError, ValueError, KeyError, IndexError):
            pass
        limit = read_number(self.cgroup / "memory.max")
        used = read_number(self.cgroup / "memory.current")
        if limit is None:
            limit = read_number(self.cgroup / "memory/memory.limit_in_bytes")
            used = read_number(self.cgroup / "memory/memory.usage_in_bytes")
        if limit is not None and used is not None and limit < 2**60:
            reclaimable = 0
            try:
                stat_file = self.cgroup / "memory.stat" if (self.cgroup / "memory.stat").exists() else self.cgroup / "memory/memory.stat"
                memory_stat = dict(line.split() for line in stat_file.read_text().splitlines())
                reclaimable = int(memory_stat.get("inactive_file", memory_stat.get("total_inactive_file", "0")))
            except (OSError, ValueError):
                pass
            # PDK file cache is reclaimable; treating it all as committed RAM
            # can otherwise leave the queue waiting forever after a large run.
            remaining = max(0, (limit - max(0, used - reclaimable)) // (1024 * 1024))
            available = remaining if available is None else min(available, remaining)
        return {
            "cpu_capacity": self.capacity,
            "cpu_sample_ready": worker_cpu is not None or host_cpu is not None or (usage is None and host is None),
            "worker_cpu_percent": round(worker_cpu, 1) if worker_cpu is not None else None,
            "host_cpu_percent": round(host_cpu, 1) if host_cpu is not None else None,
            "memory_available_mb": available,
            "disk_free_mb": shutil.disk_usage(self.root).free // (1024 * 1024),
        }


class PhysicalQueue:
    def __init__(self, root: Path, runner: Callable, *, max_running: int = 1,
                 max_pending: int = 20, per_user: int = 2, cpu_threshold: float = 60,
                 memory_reserve_mb: int = 1024, job_memory_mb: int = 2048,
                 min_disk_mb: int = 3072, retain: int = 20, retention_days: int = 7,
                 sample: Callable[[], dict[str, Any]] | None = None, interval: float = 2):
        if not (1 <= max_running <= 8 and 1 <= max_pending <= 200 and 1 <= per_user <= max_pending + max_running):
            raise ValueError("Invalid physical queue capacity")
        if not (1 <= cpu_threshold <= 100 and min(memory_reserve_mb, job_memory_mb, min_disk_mb) >= 0 and retain >= 1 and retention_days >= 1):
            raise ValueError("Invalid physical queue resource limits")
        self.root = root / "physical-queue"
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.runner = runner
        self.max_running, self.max_pending, self.per_user = max_running, max_pending, per_user
        self.cpu_threshold, self.memory_reserve_mb, self.job_memory_mb = cpu_threshold, memory_reserve_mb, job_memory_mb
        self.min_disk_mb, self.retain, self.retention_seconds = min_disk_mb, retain, retention_days * 86400
        self.sample = sample or ResourceMonitor(root).sample
        self.resources: dict[str, Any] = {}
        self.interval = interval
        self.condition = threading.Condition(threading.RLock())
        self.jobs: dict[str, dict[str, Any]] = {}
        self.events: dict[str, threading.Event] = {}
        self.stopping = False
        self.thread: threading.Thread | None = None
        self.last_dispatch_at = 0.0
        self.last_sample_at = 0.0
        self._restore()

    def _save(self, job: dict[str, Any]) -> None:
        """Atomic, fsynced acceptance/terminal state; no source data in filenames."""
        path = self.root / f'{job["job_id"]}.json'
        temporary = path.with_suffix(".tmp")
        encoded = json.dumps(job, separators=(",", ":"))
        with temporary.open("w", encoding="utf-8") as stream:
            os.chmod(temporary, 0o600)
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)

    def _restore(self) -> None:
        for path in sorted(self.root.glob("*.json")):
            try:
                job = json.loads(path.read_text(encoding="utf-8"))
                if path.stem != job["job_id"] or not job.get("owner_id") or job["status"] not in ACTIVE | TERMINAL or not isinstance(job.get("created_at"), (float, int)):
                    continue
                if job["status"] in {"running", "cancelling"}:
                    job.update(status="failed", process_alive=False, finished_at=time.time(),
                               error="El servidor de ejecución se reinició. Revise el registro y envíe un nuevo flujo.")
                    job["result"] = self._failure_result(job, job["error"], 75)
                    job.pop("payload", None)
                    self._save(job)
                if job["status"] == "queued":
                    if not isinstance(job.get("payload"), dict):
                        continue
                    self.events[job["job_id"]] = threading.Event()
                self.jobs[job["job_id"]] = job
                job.pop("result", None)  # Large artifacts stay on disk between polls.
            except (OSError, ValueError, KeyError, TypeError):
                # Leave corrupt records available to the operator, never execute them.
                continue
        self._prune()

    def _prune(self) -> None:
        terminal = sorted((j for j in self.jobs.values() if j["status"] in TERMINAL), key=lambda j: j.get("finished_at", j["created_at"]))
        now = time.time()
        for i, job in enumerate(terminal):
            if i < len(terminal) - self.retain or now - job.get("finished_at", job["created_at"]) > self.retention_seconds:
                (self.root / f'{job["job_id"]}.json').unlink(missing_ok=True)
                self.jobs.pop(job["job_id"], None)

    @staticmethod
    def _failure_result(job: dict[str, Any], message: str, code: int) -> dict[str, Any]:
        output = (str(job.get("live_output", "")) + "\n[OpenSemiLab] " + message)[-200_000:]
        return {"job_id": job["job_id"], "action": "physical", "engine": "LibreLane/OpenROAD",
                "success": False, "exit_code": code, "output": output,
                "duration_ms": int(job.get("elapsed_seconds", 0) * 1000),
                "artifacts": [{"name": "execution.log", "media_type": "text/plain", "content": output}]}

    def start(self) -> None:
        with self.condition:
            if not self.thread:
                self.thread = threading.Thread(target=self._schedule, name="physical-queue", daemon=True)
                self.thread.start()

    def stop(self) -> None:
        """Stop admission, leaving queued records durable (used by tests/shutdown)."""
        with self.condition:
            self.stopping = True
            self.condition.notify_all()
        if self.thread:
            self.thread.join(timeout=5)

    def _owned(self, job_id: str, owner: str) -> dict[str, Any]:
        job = self.jobs.get(job_id)
        if job is None or job["owner_id"] != owner:
            raise QueueError("Trabajo no encontrado para este usuario.", 404)
        return job

    def submit(self, payload: dict[str, Any], owner: str) -> dict[str, Any]:
        with self.condition:
            self._prune()
            request_id = payload.get("request_id")
            if request_id:
                existing = next((j for j in self.jobs.values() if j["owner_id"] == owner and j.get("request_id") == request_id), None)
                if existing:
                    return self._snapshot(existing)
            project_id = payload.get("project_id")
            if project_id and any(j["owner_id"] == owner and j.get("project_id") == project_id and j["status"] in ACTIVE for j in self.jobs.values()):
                raise QueueError("Este proyecto ya tiene un flujo físico activo o en cola. Abra su estado para continuar.")
            if sum(j["status"] in ACTIVE and j["owner_id"] == owner for j in self.jobs.values()) >= self.per_user:
                raise QueueError(f"Ya tiene {self.per_user} trabajos físicos activos o en espera. Cancele uno o espere a que termine.", 429)
            if sum(j["status"] == "queued" for j in self.jobs.values()) >= self.max_pending:
                raise QueueError("La cola física está llena. Espere a que se libere un turno antes de enviar otro flujo.", 429)
            job_id = uuid.uuid4().hex[:12]
            now = time.time()
            job = {"job_id": job_id, "action": "physical", "owner_id": owner,
                   "request_id": request_id, "project_id": project_id, "payload": payload, "status": "queued",
                   "created_at": now, "heartbeat_at": now, "elapsed_seconds": 0,
                   "live_output": "", "process_alive": False}
            self._save(job)  # A failed write must never acknowledge or start the job.
            self.jobs[job_id] = job
            self.events[job_id] = threading.Event()
            snapshot = self._snapshot(job)
            self.condition.notify_all()
            return snapshot

    def get(self, job_id: str, owner: str) -> dict[str, Any]:
        with self.condition:
            self._prune()
            return self._snapshot(self._owned(job_id, owner))

    def list_owned(self, owner: str) -> list[dict[str, Any]]:
        with self.condition:
            self._prune()
            return [self._snapshot(j) for j in self.jobs.values() if j["owner_id"] == owner and j["status"] in ACTIVE]

    def _pending(self) -> list[dict[str, Any]]:
        return sorted((j for j in self.jobs.values() if j["status"] == "queued"), key=lambda j: j["created_at"])

    def _active(self) -> list[dict[str, Any]]:
        return [j for j in self.jobs.values() if j["status"] in {"running", "cancelling"}]

    def _reason(self) -> str:
        if self.resources.get("admission_error"):
            return "admission_unavailable"
        if self.resources.get("cpu_sample_ready") is False:
            return "measuring"
        active = self._active()
        cpus = float(self.resources.get("cpu_capacity", 1))
        loads = [self.resources.get("worker_cpu_percent"), self.resources.get("host_cpu_percent")]
        loads += [min(100, float(j.get("cpu_percent", 0)) / cpus) for j in active]
        if any(load is not None and load > self.cpu_threshold for load in loads):
            return "cpu_busy"
        if len(active) >= self.max_running:
            return "concurrency_limit"
        # Do not start several heavy jobs before the previous admission has had
        # a full resource-sampling interval to launch its subprocess tree.
        if active and time.monotonic() - self.last_dispatch_at < self.interval:
            return "measuring"
        if active and self.resources.get("worker_cpu_percent") is None and self.resources.get("host_cpu_percent") is None:
            return "measuring"
        free = self.resources.get("memory_available_mb")
        if free is not None and free < self.memory_reserve_mb + self.job_memory_mb:
            return "memory_low"
        disk = self.resources.get("disk_free_mb")
        if disk is not None and disk < self.min_disk_mb:
            return "disk_low"
        return "waiting_turn"

    def _snapshot(self, job: dict[str, Any]) -> dict[str, Any]:
        body = {k: v for k, v in job.items() if k not in {"owner_id", "payload", "request_id"}}
        if job["status"] in TERMINAL and "result" not in body:
            try:
                stored_result = json.loads((self.root / f'{job["job_id"]}.json').read_text(encoding="utf-8")).get("result")
                if stored_result is not None:
                    body["result"] = stored_result
            except (OSError, ValueError):
                body["error"] = "El resultado guardado no está disponible. Consulte al administrador."
        pending, active = self._pending(), self._active()
        waiting = job["status"] == "queued"
        index = next((i for i, j in enumerate(pending) if j["job_id"] == job["job_id"]), 0)
        ahead = len(active) + index if waiting else 0
        now = time.time()
        body.update(jobs_ahead=ahead, queue_position=ahead + 1 if waiting else 0,
                    waiting_seconds=max(0, int(job.get("started_at", job.get("finished_at", now)) - job["created_at"])),
                    queue_reason=self._reason() if waiting else None,
                    queue={"running": len(active), "pending": len(pending), "max_running": self.max_running,
                           "cpu_threshold_percent": self.cpu_threshold, "resources": dict(self.resources)})
        if job["status"] in {"running", "cancelling"}:
            body["elapsed_seconds"] = max(0, int(now - job["started_at"]))
        return body

    def cancel(self, job_id: str, owner: str) -> dict[str, Any]:
        with self.condition:
            job = self._owned(job_id, owner)
            if job["status"] in TERMINAL:
                return self._snapshot(job)  # Idempotent; a completion/cancel race is harmless.
            now = time.time()
            if job["status"] == "queued":
                updated = {**job, "status": "cancelled", "finished_at": now, "cancellation_requested_at": now}
                updated.pop("payload", None)
                self._save(updated)
                job.clear()
                job.update(updated)
                self.events[job_id].set()
                self.events.pop(job_id, None)
                self._prune()
            else:
                updated = {**job, "status": "cancelling", "cancellation_requested_at": now}
                self._save(updated)
                job.update(updated)
                self.events[job_id].set()
            self.condition.notify_all()
            return self._snapshot(job)

    def summary(self) -> dict[str, Any]:
        with self.condition:
            return {"running": len(self._active()), "pending": len(self._pending()),
                    "max_running": self.max_running, "max_pending": self.max_pending,
                    "per_user_limit": self.per_user, "cpu_threshold_percent": self.cpu_threshold,
                    "resources": dict(self.resources)}

    def _schedule(self) -> None:
        while True:
            with self.condition:
                if self.stopping:
                    return
                try:
                    now_monotonic = time.monotonic()
                    if now_monotonic - self.last_sample_at >= self.interval:
                        self.resources = self.sample()
                        self.last_sample_at = now_monotonic
                    pending = self._pending()
                    if pending and self._reason() == "waiting_turn":
                        job = pending[0]
                        now = time.time()
                        updated = {**job, "status": "running", "started_at": now, "heartbeat_at": now}
                        previous = dict(job)
                        self._save(updated)
                        job.update(updated)
                        try:
                            threading.Thread(target=self._run, args=(job["job_id"],), daemon=True, name=f'physical-{job["job_id"]}').start()
                        except Exception:
                            # No subprocess exists yet. Preserve the FIFO turn if
                            # the OS cannot create a thread, instead of stranding
                            # the job in "running" and consuming a slot forever.
                            job.clear()
                            job.update(previous)
                            self._save(job)
                            raise
                        self.last_dispatch_at = time.monotonic()
                except Exception as error:
                    # Keep the scheduler alive; operators get an observable admission reason.
                    self.resources = {"admission_error": type(error).__name__}
                    print(f"Physical queue admission error: {error}", flush=True)
                self.condition.wait(timeout=self.interval)

    def _run(self, job_id: str) -> None:
        with self.condition:
            job = self.jobs[job_id]
            payload, event = job["payload"], self.events[job_id]
        last_checkpoint = 0.0
        def progress(values: dict[str, Any]) -> None:
            nonlocal last_checkpoint
            with self.condition:
                # Progress values are generated internally, not supplied by a client.
                job.update(values, heartbeat_at=time.time())
                if time.monotonic() - last_checkpoint >= 15:
                    last_checkpoint = time.monotonic()
                    try:
                        self._save(job)
                    except OSError:
                        job["persistence_warning"] = "No se pudo guardar el último estado. Descargue el resultado al terminar y avise al administrador."
        try:
            result = ({"success": False, "cancelled": True, "exit_code": 130, "action": "physical",
                       "engine": "LibreLane/OpenROAD", "output": "Cancelado antes de iniciar las herramientas.",
                       "duration_ms": 0, "artifacts": []}
                      if event.is_set() else self.runner(job_id, payload, progress, event))
            result["job_id"] = job_id
        except Exception as error:
            result = self._failure_result(job, f"{type(error).__name__}: {error}", 70)
        with self.condition:
            cancelled = result.get("cancelled") or event.is_set()
            status = "cancelled" if cancelled else "completed" if result.get("success") else "failed"
            if cancelled:
                result.update(cancelled=True, success=False)
            finished = time.time()
            job.update(status=status, result=result, process_alive=False, finished_at=finished,
                       elapsed_seconds=max(0, int(finished - job["started_at"])))
            job.pop("payload", None)
            self.events.pop(job_id, None)
            try:
                self._save(job)
                job.pop("result", None)
                self._prune()
            except OSError as error:
                job["persistence_warning"] = "No se pudo guardar el resultado en disco. Descargue los artefactos antes de cerrar y avise al administrador."
                print(f"Physical queue result persistence error: {error}", flush=True)
            self.condition.notify_all()
