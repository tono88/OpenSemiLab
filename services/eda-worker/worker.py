"""Constrained HTTP bridge to command-line tools in IIC-OSIC-TOOLS.

This service intentionally exposes named workflows rather than a shell.
"""

from __future__ import annotations

import gzip
import csv
import hashlib
import heapq
import io
import json
import math
import os
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import traceback
import uuid
import zipfile
from collections import deque
from base64 import b64encode
from base64 import b64decode
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from typing import Any, Callable

HOST = "0.0.0.0"
PORT = int(os.getenv("OPENSEMILAB_WORKER_PORT", "9000"))
WORK_ROOT = Path(os.getenv("OPENSEMILAB_WORK_ROOT", "/tmp/opensemilab-jobs"))
MAX_BODY = 4_500_000
MAX_OUTPUT = 200_000
TIMEOUT_SECONDS = int(os.getenv("OPENSEMILAB_JOB_TIMEOUT", "90"))
PHYSICAL_TIMEOUT_SECONDS = int(os.getenv("OPENSEMILAB_PHYSICAL_TIMEOUT", "0"))
PHYSICAL_IDLE_TIMEOUT_SECONDS = int(os.getenv("OPENSEMILAB_PHYSICAL_IDLE_TIMEOUT", "3600"))
PHYSICAL_MIN_START_FREE_MB = int(os.getenv("OPENSEMILAB_PHYSICAL_MIN_START_FREE_MB", "3072"))
PHYSICAL_MIN_RUNTIME_FREE_MB = int(os.getenv("OPENSEMILAB_PHYSICAL_MIN_RUNTIME_FREE_MB", "512"))
SAFE_PATH_COMPONENT = re.compile(r"^[A-Za-z0-9_.-]+$")
MAX_ARTIFACT_BYTES = 20_000_000
MAX_ARTIFACT_BUNDLE_BYTES = 40_000_000
MAX_COMPRESSED_ARTIFACT_SOURCE_BYTES = 250_000_000
MAX_SIGNOFF_BUNDLE_BYTES = 80_000_000
MAX_WAVEFORM_BYTES = 5_000_000
JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()
JOB_CANCEL_EVENTS: dict[str, threading.Event] = {}

STRICT_NUMBER = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?"
PHYSICAL_STAGE_RULES = [
    ("synthesis", "Synthesis", "Yosys", (r"\byosys\b", r"synth(?:esis)?", r"jsonheader")),
    ("floorplan", "Floorplan", "OpenROAD", (r"floorplan", r"tapcell", r"pdn", r"io[_ -]?placement")),
    ("placement", "Placement", "OpenROAD", (r"global[_ -]?placement", r"detailed[_ -]?placement", r"resizer")),
    ("cts", "CTS", "OpenROAD", (r"clock tree", r"\bcts\b", r"clocktree")),
    ("routing", "Routing", "OpenROAD", (r"global[_ -]?routing", r"detailed[_ -]?routing", r"\bgrt\b", r"\bdrt\b")),
    ("signoff", "Sign-off", "OpenSTA / KLayout / Magic / Netgen", (r"opensta", r"sign[ -]?off", r"klayout", r"magic", r"netgen", r"\blvs\b", r"stream[_ -]?out")),
]

TOOL_BINARIES = {
    "verilator": "verilator",
    "verible_lint": "verible-verilog-lint",
    "yosys": "yosys",
    "iverilog": "iverilog",
    "vvp": "vvp",
    "ghdl": "ghdl",
    "librelane": "librelane",
    "openroad": "openroad",
    "opensta": "sta",
    "ngspice": "ngspice",
    "xyce": "Xyce",
    "klayout": "klayout",
    "magic": "magic",
    "netgen": "netgen",
    "openems": "openEMS",
    "xschem": "xschem",
    "gtkwave": "gtkwave",
    "sby": "sby",
    "nextpnr_ice40": "nextpnr-ice40",
    "gds3d": "gds3d",
    "cace": "cace",
}

TOOL_INTEGRATIONS = {
    "verible_lint": ("direct", "RTL lint"),
    "verilator": ("direct", "RTL lint fallback"),
    "iverilog": ("direct", "Verilog simulation"),
    "vvp": ("direct", "Verilog runtime"),
    "ghdl": ("direct", "VHDL simulation"),
    "yosys": ("direct", "RTL synthesis"),
    "ngspice": ("direct", "Analog simulation"),
    "librelane": ("direct", "RTL-to-GDSII flow"),
    "openroad": ("orchestrated", "Place and route through LibreLane"),
    "opensta": ("orchestrated", "Timing through LibreLane"),
    "klayout": ("orchestrated", "Physical verification and layout artifacts"),
    "magic": ("orchestrated", "DRC/PEX through physical flow"),
    "netgen": ("orchestrated", "LVS through physical flow"),
    "xyce": ("direct", "Alternative parallel SPICE"),
    "openems": ("direct", "RF electromagnetic simulation"),
    "xschem": ("direct", "Headless schematic netlisting"),
    "gtkwave": ("available", "Waveform GUI; browser viewer is connected instead"),
    "sby": ("direct", "Formal verification"),
    "nextpnr_ice40": ("direct", "FPGA place and route"),
    "gds3d": ("direct", "Bounded native GDS 3D validation"),
    "cace": ("direct", "Circuit characterization"),
}

ADAPTER_ACTIONS = {"formal", "fpga", "xyce", "openems", "xschem", "gds3d", "cace"}
ACTION_TOOL = {
    "formal": "sby", "fpga": "nextpnr_ice40", "xyce": "xyce",
    "openems": "openems", "xschem": "xschem", "gds3d": "gds3d", "cace": "cace",
}

PHYSICAL_SCLS = {
    "sky130A": "sky130_fd_sc_hd",
    "gf180mcuD": "gf180mcu_fd_sc_mcu7t5v0",
}


def physical_targets(pdk_root: str | None) -> dict[str, dict[str, Any]]:
    root = Path(pdk_root) if pdk_root else None
    return {
        pdk: {
            "scl": scl,
            "available": bool(root and (root / pdk / "libs.ref" / scl).is_dir()),
        }
        for pdk, scl in PHYSICAL_SCLS.items()
    }


def capabilities() -> dict[str, Any]:
    tools = {}
    for name, binary in TOOL_BINARIES.items():
        path = shutil.which(binary)
        tools[name] = {"available": path is not None, "binary": binary, "path": path}

    pdk_root = os.getenv("PDK_ROOT") or os.getenv("PDKPATH")
    targets = physical_targets(pdk_root)
    actions = {
        "lint": tools["verible_lint"]["available"] or tools["verilator"]["available"],
        "simulate": tools["iverilog"]["available"] and tools["vvp"]["available"],
        "synthesize": tools["yosys"]["available"],
        "spice": tools["ngspice"]["available"],
        "vhdl": tools["ghdl"]["available"],
        "physical": tools["librelane"]["available"] and any(target["available"] for target in targets.values()),
        "formal": tools["sby"]["available"],
        "fpga": tools["yosys"]["available"] and tools["nextpnr_ice40"]["available"],
        "xyce": tools["xyce"]["available"],
        "openems": tools["openems"]["available"],
        "xschem": tools["xschem"]["available"],
        "gds3d": tools["gds3d"]["available"],
        "cace": tools["cace"]["available"],
    }
    return {
        "worker": "iic-osic-tools",
        "worker_version": "0.3.1",
        "ready": all(actions[name] for name in ("lint", "simulate", "synthesize")),
        "all_actions_ready": all(actions.values()),
        "actions": actions,
        "tools": tools,
        "integrations": [
            {"tool": name, "level": level, "purpose": purpose, "available": tools[name]["available"]}
            for name, (level, purpose) in TOOL_INTEGRATIONS.items()
        ],
        "physical_targets": targets,
        "environment": {
            "tools_root": os.getenv("TOOLS"),
            "pdk_root": pdk_root,
        },
    }


def validate_sources(raw: Any, action: str) -> dict[str, str]:
    if not isinstance(raw, dict) or not raw:
        raise ValueError("sources must be a non-empty object")
    clean: dict[str, str] = {}
    total = 0
    for filename, content in raw.items():
        path = PurePosixPath(filename) if isinstance(filename, str) else None
        if (
            path is None or path.is_absolute() or not path.parts
            or any(part in {"", ".", ".."} or not SAFE_PATH_COMPONENT.fullmatch(part) for part in path.parts)
        ):
            raise ValueError(f"unsafe source filename: {filename!r}")
        if action in {"spice", "xyce"}:
            allowed_suffixes = {".spice", ".cir", ".ckt", ".lib"}
        elif action == "vhdl":
            allowed_suffixes = {".vhd", ".vhdl"}
        elif action == "formal":
            allowed_suffixes = {".v", ".sv", ".vh", ".svh", ".sby"}
        elif action == "fpga":
            allowed_suffixes = {".v", ".sv", ".vh", ".svh", ".pcf"}
        elif action == "openems":
            allowed_suffixes = {".xml"}
        elif action == "xschem":
            allowed_suffixes = {".sch", ".sym", ".tcl", ".spice", ".lib"}
        elif action == "gds3d":
            allowed_suffixes = {".gds", ".gdsii", ".txt", ".process"}
        elif action == "cace":
            allowed_suffixes = {".yaml", ".yml", ".json", ".spice", ".cir", ".ckt", ".sch", ".sym", ".tcl", ".py"}
        else:
            allowed_suffixes = {".v", ".sv", ".vh", ".svh"}
        if Path(filename).suffix.lower() not in allowed_suffixes:
            raise ValueError(f"unsupported source type: {filename}")
        if not isinstance(content, str):
            raise ValueError(f"source must be text: {filename}")
        total += len(content.encode())
        if total > 3_000_000:
            raise ValueError("source bundle exceeds 3 MB")
        clean[filename] = content
    return clean


def find_entry(sources: dict[str, str], requested: Any, suffixes: set[str], label: str) -> str:
    if requested is not None:
        if not isinstance(requested, str) or requested not in sources or Path(requested).suffix.lower() not in suffixes:
            raise ValueError(f"entry must identify a supplied {label} file")
        return requested
    matches = sorted(name for name in sources if Path(name).suffix.lower() in suffixes)
    if not matches:
        raise ValueError(f"a {label} entry file is required")
    return matches[0]


def collect_files(job_dir: Path, suffixes: set[str], *, exclude: set[str] | None = None) -> list[dict[str, Any]]:
    artifacts: list[dict[str, Any]] = []
    total = 0
    excluded = exclude or set()
    for path in sorted(job_dir.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in suffixes:
            continue
        relative = path.relative_to(job_dir).as_posix()
        if relative in excluded:
            continue
        size = path.stat().st_size
        if size > MAX_ARTIFACT_BYTES or total + size > MAX_ARTIFACT_BUNDLE_BYTES:
            continue
        raw = path.read_bytes()
        binary = path.suffix.lower() in {".gds", ".gdsii", ".bin", ".asc", ".bit", ".png"}
        artifacts.append({
            "name": relative,
            "media_type": "application/octet-stream" if binary else "text/plain",
            "encoding": "base64" if binary else "utf-8",
            "content": b64encode(raw).decode("ascii") if binary else raw.decode("utf-8", errors="replace"),
            "size_bytes": size,
        })
        total += size
    return artifacts


def run_command(
    command: list[str],
    cwd: Path,
    timeout_seconds: int = TIMEOUT_SECONDS,
    env_overrides: dict[str, str] | None = None,
) -> dict[str, Any]:
    def output_text(value: str | bytes | None) -> str:
        if value is None:
            return ""
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")
        return value

    started = time.monotonic()
    try:
        process = subprocess.run(
            command,
            cwd=cwd,
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
            env={**os.environ, "HOME": str(cwd), **(env_overrides or {})},
        )
        stdout = output_text(process.stdout)
        stderr = output_text(process.stderr)
        output = (stdout + ("\n" if stdout and stderr else "") + stderr)[-MAX_OUTPUT:]
        return {"exit_code": process.returncode, "output": output, "duration_ms": round((time.monotonic() - started) * 1000), "timed_out": False}
    except subprocess.TimeoutExpired as error:
        stdout = output_text(error.stdout)
        stderr = output_text(error.stderr)
        output = (stdout + ("\n" if stdout and stderr else "") + stderr)[-MAX_OUTPUT:]
        return {"exit_code": 124, "output": output + f"\nTimed out after {timeout_seconds}s", "duration_ms": round((time.monotonic() - started) * 1000), "timed_out": True}


def detect_physical_stage(output: str) -> dict[str, str]:
    """Infer the furthest physical-flow stage reached from bounded console output."""
    lowered = output.lower()
    detected = {"stage": "preparing", "stage_label": "Preparing", "tool": "LibreLane"}
    for stage, label, tool, expressions in PHYSICAL_STAGE_RULES:
        if any(re.search(expression, lowered, re.IGNORECASE) for expression in expressions):
            detected = {"stage": stage, "stage_label": label, "tool": tool}
    return detected


def classify_physical_log(output: str) -> dict[str, Any]:
    """Return a conservative, read-only diagnostic summary; never changes the design."""
    groups: dict[str, dict[str, Any]] = {}
    for line in output.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if re.search(r"\b(error|fatal|failed|exception|traceback)\b", stripped, re.IGNORECASE):
            severity, category = "critical", "errors"
        elif re.search(r"\bwarn(?:ing)?\b", stripped, re.IGNORECASE):
            severity, category = "warning", "warnings"
        else:
            continue
        external_pdk = bool(re.search(r"(?:sky130_fd_io|\[STA-(?:1111|1140|1173)\])", stripped, re.IGNORECASE))
        normalized = re.sub(r"\b\d+(?:\.\d+)?\b", "#", stripped)[:240]
        key = f"{severity}:{normalized}"
        item = groups.setdefault(key, {
            "severity": severity,
            "category": "pdk_library" if external_pdk else category,
            "actionable": not external_pdk,
            "message": stripped[:500],
            "count": 0,
        })
        item["count"] += 1
    items = sorted(groups.values(), key=lambda item: (item["severity"] != "critical", -item["count"]))
    return {
        "schema": "opensemilab.log-diagnostics/v1",
        "critical_count": sum(item["count"] for item in items if item["severity"] == "critical"),
        "warning_count": sum(item["count"] for item in items if item["severity"] == "warning"),
        "external_pdk_warning_count": sum(item["count"] for item in items if item["category"] == "pdk_library"),
        "groups": items[:100],
    }


def descendant_pids(root_pid: int) -> list[int]:
    found: list[int] = []
    pending = [root_pid]
    while pending and len(found) < 512:
        pid = pending.pop()
        if pid in found:
            continue
        found.append(pid)
        try:
            children = Path(f"/proc/{pid}/task/{pid}/children").read_text(encoding="ascii").split()
            pending.extend(int(child) for child in children)
        except (FileNotFoundError, PermissionError, ValueError):
            continue
    return found


def process_resource_sample(root_pid: int) -> tuple[int, int, list[int]]:
    """Return process CPU ticks, resident KiB and descendants using Linux procfs."""
    ticks = 0
    rss_kib = 0
    pids = descendant_pids(root_pid)
    page_kib = os.sysconf("SC_PAGE_SIZE") // 1024
    for pid in pids:
        try:
            fields = Path(f"/proc/{pid}/stat").read_text(encoding="ascii").split()
            ticks += int(fields[13]) + int(fields[14])
            rss_kib += int(fields[23]) * page_kib
        except (FileNotFoundError, PermissionError, ValueError, IndexError):
            continue
    return ticks, rss_kib, pids


def disk_free_mb(path: Path) -> int:
    return shutil.disk_usage(path).free // (1024 * 1024)


def wait_for_process(process: subprocess.Popen[bytes], timeout: float | None = None) -> bool:
    """Wait for a child without losing the job when another reaper wins the race.

    Container runtimes and signal handlers can reap a process between ``poll``
    and ``wait``.  That condition must not discard LibreLane's logs and final
    artifacts; callers can still use the return code already captured by poll.
    """
    try:
        process.wait(timeout=timeout)
        return True
    except (ProcessLookupError, ChildProcessError):
        return False


def run_streaming_command(
    command: list[str],
    cwd: Path,
    timeout_seconds: int = 0,
    idle_timeout_seconds: int = PHYSICAL_IDLE_TIMEOUT_SECONDS,
    env_overrides: dict[str, str] | None = None,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
    cancel_event: threading.Event | None = None,
) -> dict[str, Any]:
    """Run a long job while reporting liveness and bounded output.

    A zero total timeout means that a healthy process is never stopped merely
    because the design is large.  The separate idle watchdog still prevents a
    permanently silent, stuck process from consuming resources forever.
    """
    started = time.monotonic()
    last_output = started
    last_activity = started
    chunks: deque[str] = deque()
    output_size = 0
    process = subprocess.Popen(
        command,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env={**os.environ, "HOME": str(cwd), **(env_overrides or {})},
        start_new_session=True,
    )
    assert process.stdout is not None
    pending: deque[bytes | None] = deque()
    condition = threading.Condition()

    def read_output() -> None:
        while True:
            block = os.read(process.stdout.fileno(), 4096)
            with condition:
                pending.append(block or None)
                condition.notify()
            if not block:
                return

    threading.Thread(target=read_output, daemon=True).start()
    stream_closed = False
    termination_reason = ""
    termination_kind: str | None = None
    last_progress = 0.0
    previous_ticks = 0
    previous_sample_at = started
    clock_ticks = os.sysconf("SC_CLK_TCK")

    def append_output(text: str) -> None:
        nonlocal output_size
        chunks.append(text)
        output_size += len(text)
        while output_size > MAX_OUTPUT and chunks:
            removed = chunks.popleft()
            output_size -= len(removed)

    def snapshot() -> str:
        return "".join(chunks)[-MAX_OUTPUT:]

    try:
        while process.poll() is None or not stream_closed:
            with condition:
                if not pending:
                    condition.wait(timeout=1.0)
                while pending:
                    block = pending.popleft()
                    if block is None:
                        stream_closed = True
                    else:
                        append_output(block.decode("utf-8", errors="replace"))
                        last_output = time.monotonic()
                        last_activity = last_output

            now = time.monotonic()
            ticks, rss_kib, pids = process_resource_sample(process.pid)
            free_disk_mb = disk_free_mb(cwd)
            sample_seconds = max(now - previous_sample_at, 0.001)
            cpu_percent = max(0.0, ((ticks - previous_ticks) / clock_ticks) / sample_seconds * 100) if previous_ticks else 0.0
            previous_ticks, previous_sample_at = ticks, now
            if cpu_percent >= 1.0:
                last_activity = now
            if timeout_seconds > 0 and now - started >= timeout_seconds:
                termination_reason = f"Timed out after {timeout_seconds}s"
                termination_kind = "total"
            elif cancel_event is not None and cancel_event.is_set():
                termination_reason = "Cancelled by the user"
                termination_kind = "cancelled"
            elif PHYSICAL_MIN_RUNTIME_FREE_MB > 0 and free_disk_mb < PHYSICAL_MIN_RUNTIME_FREE_MB:
                termination_reason = (
                    f"Stopped before disk exhaustion: only {free_disk_mb} MB remain; "
                    f"the safety reserve is {PHYSICAL_MIN_RUNTIME_FREE_MB} MB"
                )
                termination_kind = "disk"
            elif idle_timeout_seconds > 0 and now - last_activity >= idle_timeout_seconds:
                termination_reason = f"Stopped after {idle_timeout_seconds}s without output or CPU activity"
                termination_kind = "idle"

            if progress_callback and (now - last_progress >= 1.0 or stream_closed):
                stage = detect_physical_stage(snapshot())
                progress_callback({
                    "elapsed_seconds": round(now - started),
                    "last_output_seconds_ago": round(now - last_output),
                    "live_output": snapshot(),
                    "process_alive": process.poll() is None,
                    "last_activity_seconds_ago": round(now - last_activity),
                    "pid": process.pid,
                    "child_pids": pids[1:],
                    "cpu_percent": round(cpu_percent, 1),
                    "memory_mb": round(rss_kib / 1024, 1),
                    "disk_free_mb": free_disk_mb,
                    "disk_state": "low" if free_disk_mb < max(PHYSICAL_MIN_RUNTIME_FREE_MB * 2, 1024) else "ok",
                    "activity_state": "working" if cpu_percent >= 1.0 else ("waiting-output" if now - last_output < 30 else "quiet"),
                    **stage,
                })
                last_progress = now

            if termination_reason and process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                    if not wait_for_process(process, timeout=10):
                        process.returncode = process.returncode if process.returncode is not None else 70
                except ProcessLookupError:
                    process.returncode = process.returncode if process.returncode is not None else 70
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
        process_reaped = wait_for_process(process)
    finally:
        process.stdout.close()

    output = snapshot()
    if not process_reaped and process.returncode is None:
        process.returncode = 70
        output = (output + ("\n" if output else "") + "[OpenSemiLab] Process ended before its final status could be collected; preserved logs and artifacts require review.")[-MAX_OUTPUT:]
    if termination_reason:
        output = (output + ("\n" if output else "") + termination_reason)[-MAX_OUTPUT:]
    return {
        "exit_code": 130 if termination_kind == "cancelled" else (75 if termination_kind == "disk" else (124 if termination_reason else process.returncode)),
        "output": output,
        "duration_ms": round((time.monotonic() - started) * 1000),
        "timed_out": termination_kind in {"idle", "total"},
        "timeout_kind": termination_kind if termination_kind in {"idle", "total"} else None,
        "cancelled": termination_kind == "cancelled",
        "resource_exhausted": termination_kind == "disk",
        "disk_free_mb": disk_free_mb(cwd),
        **detect_physical_stage(output),
    }


def _artifact_payload(path: Path, relative: str) -> dict[str, Any]:
    raw = path.read_bytes()
    binary = path.suffix.lower() == ".gds"
    return {
        "name": relative,
        "media_type": "application/octet-stream" if binary else "text/plain",
        "encoding": "base64" if binary else "utf-8",
        "content": b64encode(raw).decode("ascii") if binary else raw.decode("utf-8", errors="replace"),
        "size_bytes": len(raw),
    }


def _compressed_artifact_payload(path: Path, relative: str) -> dict[str, Any] | None:
    """Return a bounded gzip fallback for large final GDS/DEF views."""
    size = path.stat().st_size
    if path.suffix.lower() not in {".gds", ".def"} or size > MAX_COMPRESSED_ARTIFACT_SOURCE_BYTES:
        return None
    compressed = gzip.compress(path.read_bytes(), compresslevel=6, mtime=0)
    if len(compressed) > MAX_ARTIFACT_BYTES:
        return None
    return {
        "name": relative + ".gz",
        "media_type": "application/gzip",
        "encoding": "base64",
        "content": b64encode(compressed).decode("ascii"),
        "size_bytes": len(compressed),
        "original_size_bytes": size,
    }


def physical_artifacts(job_dir: Path) -> list[dict[str, Any]]:
    """Collect a bounded set of portable final views from LibreLane."""
    candidates: list[Path] = []
    roots = [job_dir / "final", job_dir / "runs"]
    allowed = {".gds", ".def", ".lef", ".v", ".sdc", ".sdf", ".spef", ".json", ".csv", ".rpt", ".log"}
    for root in roots:
        if root.exists():
            candidates.extend(path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in allowed)
    candidates.sort(key=lambda path: (0 if "final" in path.parts else 1, len(path.parts), str(path)))
    artifacts: list[dict[str, Any]] = []
    total = 0
    seen_names: set[str] = set()
    omitted: list[dict[str, Any]] = []
    seen_content: set[str] = set()
    for path in candidates:
        size = path.stat().st_size
        relative = path.relative_to(job_dir).as_posix()
        if relative in seen_names:
            continue
        seen_names.add(relative)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in seen_content:
            omitted.append({"name": relative, "size_bytes": size, "reason": "duplicate_content"})
            continue
        seen_content.add(digest)
        if size <= MAX_ARTIFACT_BYTES and total + size <= MAX_ARTIFACT_BUNDLE_BYTES:
            artifacts.append(_artifact_payload(path, relative))
            total += size
            continue
        compressed = _compressed_artifact_payload(path, relative)
        if compressed and total + compressed["size_bytes"] <= MAX_ARTIFACT_BUNDLE_BYTES:
            artifacts.append(compressed)
            total += compressed["size_bytes"]
            continue
        omitted.append({"name": relative, "size_bytes": size, "reason": "artifact_size_limit"})
    manifest = {
        "schema": "opensemilab.artifact-manifest/v1",
        "embedded_count": len(artifacts),
        "embedded_bytes": total,
        "omitted": omitted,
    }
    artifacts.append(text_artifact("artifact-manifest.json", json.dumps(manifest, indent=2) + "\n", "application/json"))
    return artifacts


def _signoff_category(path: Path) -> str:
    lower = path.name.lower()
    suffix = path.suffix.lower()
    if suffix in {".gds", ".def", ".lef", ".oas", ".oasis"}:
        return "layout"
    if suffix in {".v", ".sv"}:
        return "netlists"
    if suffix in {".sdc", ".sdf", ".spef", ".lib"}:
        return "timing"
    if suffix in {".cdl", ".spice"}:
        return "models"
    if suffix in {".rpt", ".log", ".csv"} or any(token in lower for token in ("drc", "lvs", "antenna", "metrics", "summary")):
        return "reports"
    if suffix in {".json", ".yaml", ".yml", ".tcl"}:
        return "configuration"
    return "other"


def integration_manifest(job_dir: Path, config: dict[str, Any]) -> dict[str, Any]:
    """Inventory final integration views with stable hashes and their intended role."""
    allowed = {".gds", ".def", ".lef", ".oas", ".oasis", ".v", ".sv", ".sdc", ".sdf", ".spef", ".lib", ".cdl", ".spice", ".rpt", ".log", ".csv", ".json", ".yaml", ".yml", ".tcl"}
    candidates = sorted(
        (path for root in (job_dir / "final", job_dir / "runs") if root.exists() for path in root.rglob("*") if path.is_file() and path.suffix.lower() in allowed),
        key=lambda path: (0 if "final" in path.parts else 1, len(path.parts), str(path)),
    )
    files: list[dict[str, Any]] = []
    seen_content: set[str] = set()
    for path in candidates:
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest in seen_content:
            continue
        seen_content.add(digest)
        files.append({
            "path": path.relative_to(job_dir).as_posix(),
            "category": _signoff_category(path),
            "role": {
                ".gds": "manufacturing_layout", ".oas": "manufacturing_layout", ".oasis": "manufacturing_layout",
                ".lef": "abstract_layout", ".def": "placed_routed_layout", ".v": "logical_netlist", ".sv": "logical_netlist",
                ".sdc": "timing_constraints", ".sdf": "timing_delays", ".spef": "parasitics", ".lib": "timing_power_model",
                ".cdl": "lvs_netlist", ".spice": "circuit_model",
            }.get(path.suffix.lower(), "evidence"),
            "size_bytes": len(raw),
            "sha256": digest,
        })
    return {
        "schema": "opensemilab.integration-manifest/v1",
        "design": config.get("DESIGN_NAME"),
        "pdk": config.get("PDK"),
        "standard_cell_library": config.get("STD_CELL_LIBRARY"),
        "handoff_level": "hardened_block",
        "files": files,
    }


def signoff_bundle(
    job_dir: Path,
    config_content: str,
    sdc_content: str,
    summary_content: str,
    diagnostics_content: str,
    execution_log: str,
    readiness_content: str = "{}\n",
    manifest_content: str = "{}\n",
) -> dict[str, Any] | None:
    """Create one compressed, categorized handoff without the JSON artifact limits."""
    allowed = {".gds", ".def", ".lef", ".oas", ".oasis", ".v", ".sv", ".sdc", ".sdf", ".spef", ".lib", ".cdl", ".spice", ".rpt", ".log", ".csv", ".json", ".yaml", ".yml", ".tcl"}
    candidates = sorted(
        (path for root in (job_dir / "final", job_dir / "runs") if root.exists() for path in root.rglob("*") if path.is_file() and path.suffix.lower() in allowed),
        key=lambda path: (0 if "final" in path.parts else 1, len(path.parts), str(path)),
    )
    output = io.BytesIO()
    seen_content: set[str] = set()
    used_names: set[str] = set()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        generated = {
            "configuration/physical-config.json": config_content,
            "timing/constraints.sdc": sdc_content,
            "reports/physical-summary.json": summary_content,
            "reports/tapeout-readiness.json": readiness_content,
            "configuration/integration-manifest.json": manifest_content,
            "reports/execution-diagnostics.json": diagnostics_content,
            "logs/execution.log": execution_log,
        }
        checksums: list[str] = []
        for name, content in generated.items():
            archive.writestr(name, content)
            used_names.add(name)
            checksums.append(f"{hashlib.sha256(content.encode('utf-8')).hexdigest()}  {name}")
        for path in candidates:
            raw = path.read_bytes()
            digest = hashlib.sha256(raw).hexdigest()
            if digest in seen_content:
                continue
            seen_content.add(digest)
            relative = path.relative_to(job_dir).as_posix()
            trimmed = relative.removeprefix("final/")
            destination = f"{_signoff_category(path)}/{trimmed}"
            if destination in used_names:
                destination = f"{_signoff_category(path)}/{relative}"
            used_names.add(destination)
            archive.writestr(destination, raw)
            checksums.append(f"{digest}  {destination}")
        archive.writestr("CHECKSUMS.sha256", "\n".join(sorted(checksums)) + "\n")
    raw_zip = output.getvalue()
    if len(raw_zip) > MAX_SIGNOFF_BUNDLE_BYTES:
        return None
    return {
        "name": "signoff-package.zip",
        "media_type": "application/zip",
        "encoding": "base64",
        "content": b64encode(raw_zip).decode("ascii"),
        "size_bytes": len(raw_zip),
    }


def compact_def_layout(job_dir: Path) -> dict[str, Any] | None:
    """Extract a bounded browser layout without embedding a potentially huge DEF."""
    candidates = sorted(
        (path for root in (job_dir / "final", job_dir / "runs") if root.exists() for path in root.rglob("*.def")),
        key=lambda path: (0 if "final" in path.parts else 1, len(path.parts), str(path)),
    )
    if not candidates:
        return None
    path = candidates[0]
    units = 1000
    die: tuple[int, int, int, int] | None = None
    components: list[dict[str, Any]] = []
    component_count = 0
    placed_component_count = 0
    component_sample: list[tuple[int, str, dict[str, Any]]] = []
    section = ""
    entry = ""
    layers: dict[str, list[dict[str, Any]]] = {}
    lengths: dict[str, float] = {}
    current_layer: str | None = None
    previous: tuple[int, int] | None = None
    total_segments = 0

    def consume_component(value: str) -> None:
        nonlocal component_count, placed_component_count
        count_match = re.search(r"^\s*COMPONENTS\s+(\d+)\s*;", value, re.IGNORECASE)
        if count_match:
            component_count = int(count_match.group(1))
        if die is None:
            return
        match = re.search(r"-\s+(\S+)\s+(\S+)[\s\S]*?\+\s+(?:PLACED|FIXED)\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)", value, re.IGNORECASE)
        if match:
            master = match.group(2).lower()
            if re.search(r"(?:^|_)(?:fill|filler)(?:_|$)", master):
                return
            placed_component_count += 1
            x0, y0, _, _ = die
            component = {"name": match.group(1), "x": (int(match.group(3)) - x0) / units, "y": (int(match.group(4)) - y0) / units}
            score = int.from_bytes(hashlib.blake2b(match.group(1).encode(), digest_size=8).digest(), "big")
            item = (-score, match.group(1), component)
            if len(component_sample) < 6000:
                heapq.heappush(component_sample, item)
            elif score < -component_sample[0][0]:
                heapq.heapreplace(component_sample, item)

    with path.open("r", encoding="utf-8", errors="replace") as stream:
        for line in stream:
            units_match = re.search(r"UNITS\s+DISTANCE\s+MICRONS\s+(\d+)", line, re.IGNORECASE)
            if units_match:
                units = max(1, int(units_match.group(1)))
            die_match = re.search(r"DIEAREA\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)", line, re.IGNORECASE)
            if die_match:
                die = tuple(int(die_match.group(index)) for index in range(1, 5))  # type: ignore[assignment]
            upper = line.strip().upper()
            if upper.startswith("COMPONENTS "):
                section, entry = "components", line
                if ";" in entry:
                    consume_component(entry); entry = ""
                continue
            if upper == "END COMPONENTS":
                if entry:
                    consume_component(entry)
                section, entry = "", ""
                continue
            if re.match(r"^(?:SPECIALNETS|NETS)\s+\d+\s*;", upper):
                section, current_layer, previous = "routes", None, None
                continue
            if upper in {"END SPECIALNETS", "END NETS"}:
                section, current_layer, previous = "", None, None
                continue
            if section == "components":
                entry += line
                if ";" in entry:
                    consume_component(entry); entry = ""
                continue
            if section != "routes" or total_segments >= 16000 or die is None:
                continue
            if line.lstrip().startswith("-"):
                current_layer, previous = None, None
            layer_match = re.search(r"(?:\+\s*)?(?:ROUTED|NEW)\s+(\S+)", line, re.IGNORECASE)
            if layer_match:
                current_layer, previous = layer_match.group(1), None
            if current_layer:
                x0, y0, _, _ = die
                for point in re.finditer(r"\(\s*(-?\d+|\*)\s+(-?\d+|\*)\s*\)", line):
                    raw_x = previous[0] if point.group(1) == "*" and previous else int(point.group(1)) if point.group(1) != "*" else None
                    raw_y = previous[1] if point.group(2) == "*" and previous else int(point.group(2)) if point.group(2) != "*" else None
                    if raw_x is None or raw_y is None:
                        continue
                    current = (raw_x, raw_y)
                    if previous and previous != current:
                        segment = {"layer": current_layer, "x1": (previous[0] - x0) / units, "y1": (previous[1] - y0) / units, "x2": (raw_x - x0) / units, "y2": (raw_y - y0) / units}
                        bucket = layers.setdefault(current_layer, [])
                        if len(bucket) < 4000 and total_segments < 16000:
                            bucket.append(segment)
                            lengths[current_layer] = lengths.get(current_layer, 0.0) + abs(segment["x2"] - segment["x1"]) + abs(segment["y2"] - segment["y1"])
                            total_segments += 1
                    previous = current
            if ";" in line:
                current_layer, previous = None, None
    if die is None:
        return None
    components = [item[2] for item in sorted(component_sample, key=lambda item: (-item[0], item[1]))]
    colors = ["#58d6ff", "#ffcb6b", "#ff7597", "#b89cff", "#72e7a9", "#ff995e", "#71a7ff", "#e2ef65", "#ef7dff", "#60e3db"]
    x0, y0, x1, y1 = die
    layer_items = [{"name": name, "color": colors[index % len(colors)], "segments": layers[name], "lengthUm": lengths[name]} for index, name in enumerate(sorted(layers))]
    return {
        "schema": "opensemilab.def-layout/v1", "source": path.relative_to(job_dir).as_posix(),
        "width": (x1 - x0) / units, "height": (y1 - y0) / units,
        "component_count": placed_component_count or component_count or len(components),
        "def_component_count": component_count or placed_component_count or len(components),
        "sampled_component_count": len(components), "components": components, "layers": layer_items,
    }


def text_artifact(name: str, content: str, media_type: str = "text/plain") -> dict[str, Any]:
    return {
        "name": name,
        "media_type": media_type,
        "encoding": "utf-8",
        "content": content,
        "size_bytes": len(content.encode()),
    }


def parse_numeric(token: str) -> float | None:
    try:
        if "," in token:
            real, imaginary = token.strip("(),").split(",", 1)
            return (float(real) ** 2 + float(imaginary) ** 2) ** 0.5
        return float(token)
    except (ValueError, OverflowError):
        return None


def spice_axis(name: str) -> tuple[str, str]:
    lower = name.lower()
    if "time" in lower:
        return "Time", "s"
    if "freq" in lower:
        return "Frequency", "Hz"
    if "sweep" in lower or "voltage" in lower:
        return "Sweep", "V"
    if "temp" in lower:
        return "Temperature", "°C"
    return name, ""


def spice_unit(name: str) -> str:
    lower = name.lower()
    if lower.startswith("v(") or "voltage" in lower:
        return "V"
    if lower.startswith("i(") or lower.startswith("@") or "current" in lower:
        return "A"
    return ""


def parse_spice_tables(log: str) -> dict[str, Any]:
    """Convert ngspice .print tables into portable chart series."""
    lines = log.splitlines()
    plots: list[dict[str, Any]] = []
    index = 0
    while index < len(lines):
        header = lines[index].strip().split()
        if len(header) < 3 or header[0].lower() != "index":
            index += 1
            continue
        rows: list[list[float]] = []
        cursor = index + 1
        while cursor < len(lines):
            tokens = lines[cursor].strip().split()
            if not tokens or set("".join(tokens)) <= {"-"}:
                cursor += 1
                continue
            if not tokens[0].isdigit():
                break
            values = [parse_numeric(token) for token in tokens[1:len(header)]]
            if len(values) == len(header) - 1 and all(value is not None for value in values):
                rows.append([float(value) for value in values if value is not None])
            cursor += 1
        if rows:
            x_name = header[1]
            x_label, x_unit = spice_axis(x_name)
            series = []
            for column, name in enumerate(header[2:], start=1):
                series.append({
                    "name": name,
                    "x_label": x_label,
                    "x_unit": x_unit,
                    "y_label": name,
                    "y_unit": spice_unit(name),
                    "x": [row[0] for row in rows],
                    "y": [row[column] for row in rows],
                })
            plots.append({"name": f"ngspice table {len(plots) + 1}", "analysis": x_name, "series": series})
        index = max(cursor, index + 1)
    return {"schema": "opensemilab.simulation/v1", "engine": "ngspice", "plots": plots}


def parse_xyce_outputs(job_dir: Path) -> dict[str, Any]:
    """Normalize bounded Xyce .prn/.csv tables for the browser plot player."""
    plots: list[dict[str, Any]] = []
    for path in sorted([*job_dir.glob("*.prn"), *job_dir.glob("*.csv")]):
        if path.stat().st_size > MAX_WAVEFORM_BYTES:
            continue
        lines = [line.strip() for line in path.read_text(encoding="utf-8", errors="replace").splitlines() if line.strip() and not line.lstrip().startswith(('#', '*'))]
        if len(lines) < 2:
            continue
        split = (lambda value: [part.strip() for part in value.split(",")]) if "," in lines[0] else (lambda value: value.split())
        header = split(lines[0])
        if len(header) < 2:
            continue
        rows: list[list[float]] = []
        for line in lines[1:]:
            tokens = split(line)
            values = [parse_numeric(token) for token in tokens[:len(header)]]
            if len(values) == len(header) and all(value is not None for value in values):
                rows.append([float(value) for value in values if value is not None])
        if not rows:
            continue
        x_label, x_unit = spice_axis(header[0])
        series = [{
            "name": name, "x_label": x_label, "x_unit": x_unit,
            "y_label": name, "y_unit": spice_unit(name),
            "x": [row[0] for row in rows], "y": [row[column] for row in rows],
        } for column, name in enumerate(header[1:], start=1) if name.upper() != "INDEX"]
        if series:
            plots.append({"name": path.name, "analysis": header[0], "series": series})
    return {"schema": "opensemilab.simulation/v1", "engine": "Xyce", "plots": plots}


def physical_summary(job_dir: Path, config: dict[str, Any]) -> dict[str, Any]:
    metric_values: dict[str, float] = {}
    metric_files = sorted(job_dir.rglob("metrics.csv"), key=lambda path: (0 if "final" in path.parts else 1, len(path.parts), str(path)))
    if metric_files:
        with metric_files[0].open("r", encoding="utf-8", errors="replace", newline="") as stream:
            for row in csv.reader(stream):
                if len(row) < 2 or row[0].strip().lower() == "metric":
                    continue
                value = parse_numeric(row[1].strip())
                if value is not None:
                    metric_values[row[0].strip()] = value

    def metric_value(*names: str) -> float | None:
        return next((metric_values[name] for name in names if name in metric_values), None)

    die_width = die_height = 0.0
    if isinstance(config.get("DIE_AREA"), list) and len(config["DIE_AREA"]) >= 4:
        die_width = float(config["DIE_AREA"][2]) - float(config["DIE_AREA"][0])
        die_height = float(config["DIE_AREA"][3]) - float(config["DIE_AREA"][1])
    else:
        def_candidates = sorted(job_dir.rglob("*.def"), key=lambda path: (0 if "final" in path.parts else 1, len(path.parts), str(path)))
        for def_path in def_candidates:
            with def_path.open("r", encoding="utf-8", errors="replace") as stream:
                head = stream.read(200_000)
            units_match = re.search(r"UNITS\s+DISTANCE\s+MICRONS\s+(\d+)", head, re.IGNORECASE)
            die_match = re.search(r"DIEAREA\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)\s*\(\s*(-?\d+)\s+(-?\d+)\s*\)", head, re.IGNORECASE)
            if die_match:
                units = max(1, int(units_match.group(1))) if units_match else 1000
                die_width = (int(die_match.group(3)) - int(die_match.group(1))) / units
                die_height = (int(die_match.group(4)) - int(die_match.group(2))) / units
                break
    die_area = die_width * die_height
    summary: dict[str, Any] = {
        "schema": "opensemilab.physical-summary/v1",
        "pdk": config["PDK"],
        "scl": config["STD_CELL_LIBRARY"],
        "die_area_um2": die_area,
        "target_utilization_pct": float(config["FP_CORE_UTIL"]),
        "clock_period_ns": float(config.get("CLOCK_PERIOD", 10.0)),
        "floorplan_mode": "auto" if config.get("FP_SIZING") == "relative" else "manual",
        "die_width_um": die_width or None,
        "die_height_um": die_height or None,
        "cell_count": None,
        "wns_ns": None,
        "tns_ns": None,
        "drc_violations": None,
        "estimated_critical_path_ns": None,
        "estimated_max_frequency_mhz": None,
        "recommended_period_ns": None,
        "core_area_um2": metric_value("design__core__area"),
        "stdcell_area_um2": metric_value("design__instance__area__stdcell"),
        "actual_utilization_pct": None,
        "setup_worst_slack_ns": metric_value("timing__setup__ws"),
        "hold_worst_slack_ns": metric_value("timing__hold__ws"),
        "max_slew_violations": metric_value("design__max_slew_violation__count"),
        "max_cap_violations": metric_value("design__max_cap_violation__count"),
        "max_fanout_violations": metric_value("design__max_fanout_violation__count"),
        "setup_violations": metric_value("timing__setup__violations", "timing__setup_violation__count"),
        "hold_violations": metric_value("timing__hold__violations", "timing__hold_violation__count"),
        "unmapped_cells": metric_value("design__instance__count__unmapped", "synthesis__unmapped_cell__count"),
        "lvs_errors": metric_value("design__lvs_error__count"),
        "antenna_violations": metric_value("route__antenna_violation__count"),
        "power_grid_violations": metric_value("design__power_grid_violation__count"),
        "disconnected_pins": metric_value("design__disconnected_pin__count"),
        "critical_disconnected_pins": metric_value("design__critical_disconnected_pin__count"),
        "recommended_die_width_um": None,
        "recommended_die_height_um": None,
        "missing_handoff_artifacts": [],
        "signoff_blockers": [],
        "signoff_warnings": [],
        "signoff_status": "review",
        "production_ready": False,
        "handoff_level": "hardened_block",
        "readiness_level": "implementation_review",
        "constraint_scope": "project_sdc" if (job_dir / ".opensemilab-project-sdc").exists() else "clock_only",
        "pdk_distribution_status": "experimental_open_pdk",
        "tapeout_readiness": {},
    }
    text_files = [path for root in (job_dir / "final", job_dir / "runs") if root.exists() for path in root.rglob("*") if path.is_file() and path.suffix.lower() in {".def", ".rpt", ".log", ".csv", ".json"}]
    patterns = {
        "wns_ns": [rf"timing__setup__wns[\t ,:=]+({STRICT_NUMBER})", rf"\bWNS\b[^\n0-9.+-]*({STRICT_NUMBER})"],
        "tns_ns": [rf"timing__setup__tns[\t ,:=]+({STRICT_NUMBER})", rf"\bTNS\b[^\n0-9.+-]*({STRICT_NUMBER})"],
        "drc_violations": [
            r"route__drc_errors[\t ,:=]+([0-9]+)",
            r"(?im)^\s*(?:total\s+)?drc\s+(?:violations|errors)\s*[:=]\s*([0-9]+)\s*$",
            r"(?im)^\s*([0-9]+)\s+(?:drc\s+)?(?:violations|errors)\s*$",
        ],
    }
    drc_passed = False
    for path in text_files:
        if path.stat().st_size > 5_000_000:
            continue
        content = path.read_text(encoding="utf-8", errors="replace")
        if re.search(r"(?im)^\s*\*\s*DRC\s*$\s*^\s*Passed\b", content):
            drc_passed = True
        if summary["cell_count"] is None and path.suffix.lower() == ".def":
            match = re.search(r"(?im)^COMPONENTS\s+(\d+)\s*;", content)
            if match:
                summary["cell_count"] = int(match.group(1))
        for key, expressions in patterns.items():
            if summary[key] is not None:
                continue
            for expression in expressions:
                match = re.search(expression, content, re.IGNORECASE)
                if match:
                    value = parse_numeric(match.group(1))
                    if value is not None:
                        summary[key] = int(value) if key == "drc_violations" else value
                        break
    if summary["drc_violations"] is None and drc_passed:
        summary["drc_violations"] = 0
    utilization = metric_value("design__instance__utilization__stdcell", "design__instance__utilization")
    if utilization is not None:
        summary["actual_utilization_pct"] = utilization * 100 if utilization <= 1 else utilization
    elif summary["stdcell_area_um2"] is not None and summary["core_area_um2"]:
        summary["actual_utilization_pct"] = summary["stdcell_area_um2"] / summary["core_area_um2"] * 100
    timing_slack = summary["setup_worst_slack_ns"] if summary["setup_worst_slack_ns"] is not None else summary["wns_ns"]
    if timing_slack is not None:
        critical_path = summary["clock_period_ns"] - timing_slack
        if critical_path > 0:
            summary["estimated_critical_path_ns"] = critical_path
            summary["estimated_max_frequency_mhz"] = 1000.0 / critical_path
            if timing_slack < 0:
                summary["recommended_period_ns"] = math.ceil(critical_path * 1.05 * 2) / 2

    if summary["stdcell_area_um2"] and summary["target_utilization_pct"]:
        core_ratio = (summary["core_area_um2"] or die_area) / die_area if die_area else 1.0
        core_ratio = min(1.0, max(0.5, core_ratio))
        desired_die_area = summary["stdcell_area_um2"] / (summary["target_utilization_pct"] / 100) / core_ratio * 1.20
        aspect = die_width / max(1.0, die_height) if die_width and die_height else 1.0
        recommended_width = math.sqrt(desired_die_area * aspect)
        recommended_height = math.sqrt(desired_die_area / aspect)
        summary["recommended_die_width_um"] = math.ceil(recommended_width / 50) * 50
        summary["recommended_die_height_um"] = math.ceil(recommended_height / 50) * 50

    available = [path for root in (job_dir / "final", job_dir / "runs") if root.exists() for path in root.rglob("*") if path.is_file()]
    requirements = {
        "GDSII": lambda path: path.suffix.lower() == ".gds",
        "DEF": lambda path: path.suffix.lower() == ".def",
        "LEF": lambda path: path.suffix.lower() == ".lef",
        "post-PnR netlist": lambda path: path.suffix.lower() in {".v", ".sv"} and ("pnl" in path.name.lower() or "nl" in path.name.lower()),
        "SDC": lambda path: path.suffix.lower() == ".sdc",
        "SDF": lambda path: path.suffix.lower() == ".sdf",
        "SPEF": lambda path: path.suffix.lower() == ".spef",
    }
    summary["missing_handoff_artifacts"] = [name for name, predicate in requirements.items() if not any(predicate(path) for path in available)]
    blockers: list[str] = []
    for key, label in (
        ("drc_violations", "DRC"), ("lvs_errors", "LVS"), ("antenna_violations", "antenna"),
        ("power_grid_violations", "power grid"), ("max_slew_violations", "maximum slew"),
        ("max_cap_violations", "maximum capacitance"), ("max_fanout_violations", "maximum fanout"),
        ("setup_violations", "setup violations"), ("hold_violations", "hold violations"),
        ("unmapped_cells", "unmapped cells"),
        ("critical_disconnected_pins", "critical disconnected pins"),
    ):
        value = summary.get(key)
        if value is not None and value > 0:
            blockers.append(f"{label}: {int(value)}")
    if summary["wns_ns"] is not None and summary["wns_ns"] < 0:
        blockers.append(f"setup timing WNS: {summary['wns_ns']:.3f} ns")
    if summary["tns_ns"] is not None and summary["tns_ns"] < 0:
        blockers.append(f"setup timing TNS: {summary['tns_ns']:.3f} ns")
    warnings: list[str] = []
    if summary["disconnected_pins"]:
        warnings.append(f"disconnected pins: {int(summary['disconnected_pins'])}")
    if summary["missing_handoff_artifacts"]:
        warnings.append("missing handoff artifacts: " + ", ".join(summary["missing_handoff_artifacts"]))
    if summary["constraint_scope"] == "clock_only":
        warnings.append("generated SDC constrains the clock only; project-specific I/O delays and loads require review")
    warnings.append("the open PDK distribution is not a foundry production certification")
    summary["signoff_blockers"] = blockers
    summary["signoff_warnings"] = warnings
    summary["signoff_status"] = "fail" if blockers else "review" if warnings else "pass"
    def zero_check(identifier: str, label: str, value: float | None, evidence: str) -> dict[str, str]:
        return {"id": identifier, "label": label, "status": "review" if value is None else "pass" if value == 0 else "fail", "evidence": evidence}

    timing_known = summary["wns_ns"] is not None and summary["tns_ns"] is not None
    electrical_values = [summary["max_slew_violations"], summary["max_cap_violations"], summary["max_fanout_violations"]]
    checks = [
        zero_check("synthesis_integrity", "Synthesis integrity", summary["unmapped_cells"], f"{summary['unmapped_cells']} unmapped cells"),
        {"id": "sta_setup", "label": "Setup timing", "status": "review" if not timing_known else "pass" if summary["wns_ns"] >= 0 and summary["tns_ns"] >= 0 else "fail", "evidence": f"WNS {summary['wns_ns']} ns; TNS {summary['tns_ns']} ns"},
        {"id": "sta_hold", "label": "Hold timing", "status": "review" if summary["hold_worst_slack_ns"] is None and summary["hold_violations"] is None else "pass" if (summary["hold_worst_slack_ns"] is None or summary["hold_worst_slack_ns"] >= 0) and (summary["hold_violations"] is None or summary["hold_violations"] == 0) else "fail", "evidence": f"worst slack {summary['hold_worst_slack_ns']} ns; {summary['hold_violations']} violations"},
        {"id": "electrical", "label": "Slew, capacitance and fanout", "status": "review" if any(value is None for value in electrical_values) else "pass" if sum(electrical_values) == 0 else "fail", "evidence": f"slew {summary['max_slew_violations']}; cap {summary['max_cap_violations']}; fanout {summary['max_fanout_violations']}"},
        zero_check("drc", "Design-rule check", summary["drc_violations"], f"{summary['drc_violations']} violations"),
        zero_check("lvs", "Layout versus schematic", summary["lvs_errors"], f"{summary['lvs_errors']} errors"),
        zero_check("antenna", "Antenna", summary["antenna_violations"], f"{summary['antenna_violations']} violations"),
        zero_check("power_grid", "Power-grid connectivity", summary["power_grid_violations"], f"{summary['power_grid_violations']} violations"),
        {"id": "constraints", "label": "Project timing constraints", "status": "pass" if summary["constraint_scope"] == "project_sdc" else "review", "evidence": summary["constraint_scope"]},
        {"id": "handoff_views", "label": "Hardened-block integration views", "status": "pass" if not summary["missing_handoff_artifacts"] else "review", "evidence": "complete" if not summary["missing_handoff_artifacts"] else "missing: " + ", ".join(summary["missing_handoff_artifacts"])},
        {"id": "rtl_equivalence", "label": "RTL-to-netlist equivalence", "status": "not_run", "evidence": "requires a dedicated equivalence run and reviewed black-box mapping"},
        {"id": "cdc_rdc", "label": "CDC/RDC", "status": "not_run", "evidence": "requires clock/reset-domain constraints and a dedicated analysis tool"},
        {"id": "ir_em", "label": "IR drop and electromigration", "status": "not_run", "evidence": "requires extracted power intent, activity and qualified models"},
        {"id": "full_chip", "label": "Pad ring, ESD, seal ring and package", "status": "not_run", "evidence": "current result is a hardened core block"},
        {"id": "foundry_release", "label": "Foundry-qualified decks and release", "status": "not_run", "evidence": "open PDK results are not a foundry production approval"},
    ]
    summary["readiness_level"] = "implementation_failed" if blockers else "hardened_block_candidate" if not summary["missing_handoff_artifacts"] else "implementation_review"
    summary["tapeout_readiness"] = {
        "schema": "opensemilab.tapeout-readiness/v1",
        "status": "fail" if blockers else "review",
        "level": summary["readiness_level"],
        "production_ready": False,
        "checks": checks,
        "disclaimer": "Automated evidence summary only; foundry production release requires qualified decks, full-chip checks and authorized sign-off.",
    }
    return summary


def validate_physical_top(sources: dict[str, str], top: str, clock_port: str) -> None:
    """Fail fast when the requested top/clock cannot be found in the supplied RTL."""
    module_expression = re.compile(rf"\bmodule\s+{re.escape(top)}\b([\s\S]*?);", re.IGNORECASE)
    for content in sources.values():
        match = module_expression.search(re.sub(r"/\*[\s\S]*?\*/|//[^\n]*", "", content))
        if not match:
            continue
        if not re.search(rf"\b{re.escape(clock_port)}\b", match.group(1)):
            raise ValueError(
                f"PHYSICAL PREFLIGHT ERROR: clock port '{clock_port}' is not declared by top module '{top}'. "
                "Select the real clock input before starting the long RTL-to-GDSII flow."
            )
        return
    raise ValueError(
        f"PHYSICAL PREFLIGHT ERROR: top module '{top}' was not found in the supplied RTL sources."
    )


def physical_sdc(clock_port: str, clock_period: float) -> str:
    """Create a minimal design-specific constraint shared by PnR and sign-off."""
    uncertainty = max(0.05, min(0.5, clock_period * 0.005))
    return (
        "# Generated by OpenSemiLab. Add interface delays in a project-specific SDC when required.\n"
        f"set clk_input {{{clock_port}}}\n"
        f"create_clock -name {{{clock_port}}} -period {clock_period:g} [get_ports $clk_input]\n"
        f"set_clock_uncertainty {uncertainty:g} [get_clocks {{{clock_port}}}]\n"
    )


def validate_sdc_content(content: str) -> None:
    if len(content.encode()) > 100_000:
        raise ValueError("project SDC exceeds 100 KB")
    forbidden = ("[exec", "source ", "open ", "socket ", "package require", "file delete", "file rename")
    if any(token in content.lower() for token in forbidden):
        raise ValueError("project SDC contains commands that are not allowed in the isolated flow")


def adapter_result(action: str, engine: str, job_id: str, result: dict[str, Any], artifacts: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    return {
        "job_id": job_id,
        "action": action,
        "engine": engine,
        "success": result["exit_code"] == 0,
        **result,
        "artifacts": artifacts,
        **extra,
    }


def execute_adapter(action: str, payload: dict[str, Any], sources: dict[str, str], source_names: list[str], top: str, job_id: str, job_dir: Path) -> dict[str, Any]:
    tool = ACTION_TOOL[action]
    binary = TOOL_BINARIES[tool]
    if not shutil.which(binary):
        raise RuntimeError(f"{binary} is unavailable after IIC-OSIC environment initialization")
    options = payload.get("adapter") or {}
    if not isinstance(options, dict):
        raise ValueError("adapter options must be an object")

    if action == "formal":
        entry = next((name for name in source_names if name.endswith(".sby")), None)
        mode = str(options.get("mode", "bmc")).lower()
        if mode not in {"bmc", "prove"}:
            raise ValueError("formal mode must be bmc or prove")
        if entry is None:
            depth = int(options.get("depth", 20))
            if not 1 <= depth <= 1000:
                raise ValueError("formal depth must be between 1 and 1000")
            rtl = [name for name in source_names if Path(name).suffix.lower() in {".v", ".sv", ".vh", ".svh"}]
            if not rtl:
                raise ValueError("formal verification requires Verilog/SystemVerilog sources")
            rtl_basenames = [Path(name).name for name in rtl]
            if len(set(rtl_basenames)) != len(rtl_basenames):
                raise ValueError("formal verification requires unique source basenames across project folders")
            entry = "opensemilab.sby"
            config = "\n".join([
                "[options]", f"mode {mode}", f"depth {depth}", "", "[engines]", "smtbmc", "",
                "[script]", f"read -formal -sv {' '.join(rtl_basenames)}", f"prep -top {top}", "", "[files]", *rtl, "",
            ])
            (job_dir / entry).write_text(config, encoding="utf-8")
        result = run_command([binary, "-f", entry], job_dir)
        artifacts = collect_files(job_dir, {".sby", ".log", ".txt", ".vcd", ".json", ".xml"}, exclude=set(source_names))
        output_upper = result["output"].upper()
        if result["exit_code"] == 0 or "DONE (PASS" in output_upper:
            formal_status = "pass"
        elif "DONE (UNKNOWN" in output_upper or "TEMPORAL INDUCTION FAILED" in output_upper:
            formal_status = "unknown"
        elif "DONE (FAIL" in output_upper or "ASSERT FAILED" in output_upper:
            formal_status = "fail"
        else:
            formal_status = "error"
        return adapter_result(action, f"SymbiYosys ({mode.upper()})", job_id, result, artifacts, formal_status=formal_status, formal_mode=mode)

    if action == "fpga":
        rtl = [name for name in source_names if Path(name).suffix.lower() in {".v", ".sv", ".vh", ".svh"}]
        if not rtl:
            raise ValueError("FPGA implementation requires Verilog/SystemVerilog sources")
        device = str(options.get("device", "up5k")).lower()
        if device not in {"hx1k", "hx8k", "lp1k", "lp8k", "up5k", "u4k"}:
            raise ValueError("unsupported iCE40 device")
        package = str(options.get("package", "sg48"))
        if not SAFE_PATH_COMPONENT.fullmatch(package):
            raise ValueError("invalid FPGA package")
        frequency = float(options.get("frequency_mhz", 12.0))
        if not 0.1 <= frequency <= 500:
            raise ValueError("FPGA frequency must be between 0.1 and 500 MHz")
        pcf = next((name for name in source_names if name.endswith(".pcf")), None)
        synth_script = f"read_verilog -sv {' '.join(rtl)}; synth_ice40 -top {top} -json netlist.json"
        synth = run_command([TOOL_BINARIES["yosys"], "-p", synth_script], job_dir)
        if synth["exit_code"] != 0:
            return adapter_result(action, "Yosys/nextpnr-ice40", job_id, synth, [])
        package_io_limits = {"sg48": 39, "uwg30": 21, "cm36": 25, "tq144": 107, "ct256": 206}
        try:
            netlist = json.loads((job_dir / "netlist.json").read_text(encoding="utf-8"))
            ports = netlist.get("modules", {}).get(top, {}).get("ports", {})
            io_bits = sum(len(port.get("bits", [])) for port in ports.values())
        except (OSError, ValueError, TypeError):
            io_bits = 0
        io_limit = package_io_limits.get(package.lower())
        if io_limit and io_bits > io_limit:
            diagnostic = {
                "exit_code": 2,
                "output": (
                    "SYNTHESIS\n" + synth["output"] + "\nFPGA PREFLIGHT\n"
                    f"ERROR: FPGA top '{top}' exposes {io_bits} I/O bits, but package {package} supports at most {io_limit}. "
                    "Select or create a board wrapper with only physical clock, reset, LED/button and peripheral pins, "
                    "then set execution.fpga_top to that wrapper module."
                ),
                "duration_ms": synth["duration_ms"],
                "timed_out": False,
            }
            return adapter_result(action, "Yosys/nextpnr-ice40", job_id, diagnostic, [], fpga_status="io_overflow", io_bits=io_bits, io_limit=io_limit)
        command = [binary, f"--{device}", "--package", package, "--json", "netlist.json", "--asc", "design.asc", "--freq", str(frequency), "--pcf-allow-unconstrained"]
        if pcf:
            command.extend(["--pcf", pcf])
        result = run_command(command, job_dir)
        result["output"] = "SYNTHESIS\n" + synth["output"] + "\nPLACE AND ROUTE\n" + result["output"]
        result["duration_ms"] += synth["duration_ms"]
        artifacts = collect_files(job_dir, {".json", ".asc", ".rpt", ".log"}, exclude=set(source_names))
        return adapter_result(action, "Yosys/nextpnr-ice40", job_id, result, artifacts)

    if action == "xyce":
        entry = find_entry(sources, payload.get("entry"), {".spice", ".cir", ".ckt"}, "SPICE")
        result = run_command([binary, "-l", "xyce.log", entry], job_dir)
        log = (job_dir / "xyce.log").read_text(encoding="utf-8", errors="replace") if (job_dir / "xyce.log").exists() else result["output"]
        result["output"] = log[-MAX_OUTPUT:]
        artifacts = collect_files(job_dir, {".log", ".prn", ".csv", ".raw", ".mt0"}, exclude=set(source_names))
        simulation = parse_xyce_outputs(job_dir)
        if simulation["plots"]:
            artifacts.insert(0, text_artifact("simulation-data.json", json.dumps(simulation, separators=(",", ":")), "application/json"))
        return adapter_result(action, "Xyce", job_id, result, artifacts, simulation=simulation)

    if action == "openems":
        entry = find_entry(sources, payload.get("entry"), {".xml"}, "openEMS XML")
        result = run_command([binary, entry], job_dir, timeout_seconds=min(TIMEOUT_SECONDS, 90))
        artifacts = collect_files(job_dir, {".xml", ".h5", ".vtk", ".vtr", ".s1p", ".s2p", ".csv", ".log"}, exclude=set(source_names))
        return adapter_result(action, "openEMS", job_id, result, artifacts)

    if action == "xschem":
        entry = find_entry(sources, payload.get("entry"), {".sch"}, "Xschem schematic")
        netlist_dir = job_dir / "netlist"
        netlist_dir.mkdir()
        result = run_command([binary, "-n", "-q", "-x", "-o", str(netlist_dir), "-N", "generated.spice", entry], job_dir)
        artifacts = collect_files(job_dir, {".spice", ".cir", ".v", ".vhdl", ".log"}, exclude=set(source_names))
        return adapter_result(action, "Xschem", job_id, result, artifacts)

    if action == "cace":
        entry = find_entry(sources, payload.get("entry"), {".yaml", ".yml", ".json"}, "CACE datasheet")
        result = run_command([binary, entry], job_dir, timeout_seconds=min(TIMEOUT_SECONDS, 90))
        artifacts = collect_files(job_dir, {".json", ".yaml", ".yml", ".csv", ".log", ".txt", ".png", ".svg"}, exclude=set(source_names))
        return adapter_result(action, "CACE", job_id, result, artifacts)

    # GDS3D is an interactive OpenGL application. The adapter performs a bounded
    # import smoke test in the worker display while the browser's physical
    # explorer remains the interactive renderer.
    gds = find_entry(sources, payload.get("entry"), {".gds", ".gdsii"}, "GDSII")
    process_file = next((name for name in source_names if Path(name).suffix.lower() in {".process", ".txt"}), None)
    if process_file is None:
        process_file = "opensemilab.process"
        (job_dir / process_file).write_text(
            "LayerStart: Substrate\nLayer: 255\nHeight: 0\nThickness: 500\nRed: 0.25\nGreen: 0.32\nBlue: 0.28\nFilter: 0.5\nMetal: 0\nShow: 1\nLayerEnd\n",
            encoding="utf-8",
        )
    command = [binary, "-p", process_file, "-i", gds, "-t", top, "-u", "-v"]
    xvfb = shutil.which("xvfb-run")
    if xvfb:
        command = [xvfb, "-a", *command]
    result = run_command(command, job_dir, timeout_seconds=8)
    launched = result["timed_out"] and not re.search(r"(?:fatal|cannot read|invalid gds|segmentation fault)", result["output"], re.IGNORECASE)
    if launched:
        result["exit_code"] = 0
        result["timed_out"] = False
        result["output"] += "\nGDS3D imported the layout and remained active until the bounded validation window closed."
    artifacts = collect_files(job_dir, {".process", ".txt", ".geo", ".pro"}, exclude=set(source_names))
    return adapter_result(action, "GDS3D", job_id, result, artifacts)


def execute(
    payload: dict[str, Any],
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
    cancel_event: threading.Event | None = None,
) -> dict[str, Any]:
    action = payload.get("action")
    allowed_actions = {"lint", "simulate", "synthesize", "spice", "vhdl", "physical"} | ADAPTER_ACTIONS
    if action not in allowed_actions:
        raise ValueError(f"action must be one of: {', '.join(sorted(allowed_actions))}")
    sources = validate_sources(payload.get("sources"), action)
    top = payload.get("top", "top")
    if not isinstance(top, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$]*", top):
        raise ValueError("invalid top module")

    job_id = uuid.uuid4().hex[:12]
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    job_dir = Path(tempfile.mkdtemp(prefix=f"job-{job_id}-", dir=WORK_ROOT))
    try:
        encodings = payload.get("encodings") or {}
        if not isinstance(encodings, dict):
            raise ValueError("encodings must be an object")
        for filename, content in sources.items():
            destination = job_dir / filename
            destination.parent.mkdir(parents=True, exist_ok=True)
            if encodings.get(filename) == "base64":
                try:
                    destination.write_bytes(b64decode(content, validate=True))
                except ValueError as error:
                    raise ValueError(f"invalid base64 source: {filename}") from error
            else:
                destination.write_text(content, encoding="utf-8")
        source_names = sorted(sources)
        if action in ADAPTER_ACTIONS:
            return execute_adapter(action, payload, sources, source_names, top, job_id, job_dir)
        if action == "physical":
            binary = TOOL_BINARIES["librelane"]
            if not shutil.which(binary):
                raise RuntimeError("LibreLane is unavailable after IIC-OSIC environment initialization")
            available_disk_mb = disk_free_mb(job_dir)
            if PHYSICAL_MIN_START_FREE_MB > 0 and available_disk_mb < PHYSICAL_MIN_START_FREE_MB:
                raise RuntimeError(
                    f"PHYSICAL PREFLIGHT ERROR: only {available_disk_mb} MB are free in {WORK_ROOT}; "
                    f"at least {PHYSICAL_MIN_START_FREE_MB} MB are required before RTL-to-GDSII. "
                    "Free Docker disk space or enlarge the worker job volume, then retry."
                )
            pdk_root = os.getenv("PDK_ROOT") or os.getenv("PDKPATH")
            if not pdk_root:
                raise RuntimeError("PDK_ROOT is not configured in the IIC-OSIC environment")
            options = payload.get("physical")
            if not isinstance(options, dict):
                raise ValueError("physical options are required")
            pdk = options.get("pdk")
            if pdk not in PHYSICAL_SCLS:
                raise ValueError("physical implementation currently supports sky130A and gf180mcuD")
            scl = PHYSICAL_SCLS[pdk]
            scl_root = Path(pdk_root) / pdk / "libs.ref" / scl
            if not scl_root.is_dir():
                libraries_root = scl_root.parent
                available = sorted(path.name for path in libraries_root.iterdir() if path.is_dir()) if libraries_root.is_dir() else []
                installed = ", ".join(available) if available else "none"
                raise RuntimeError(
                    f"The standard-cell library {scl} required by {pdk} is not installed under "
                    f"{libraries_root}. Installed libraries: {installed}"
                )
            clock_port = options.get("clock_port", "clk")
            if not isinstance(clock_port, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$]*", clock_port):
                raise ValueError("invalid clock port")
            clock_period = float(options.get("clock_period_ns", 25.0))
            die_width = float(options.get("die_width_um", 120.0))
            die_height = float(options.get("die_height_um", 120.0))
            utilization = float(options.get("core_utilization_pct", 40.0))
            floorplan_mode = options.get("floorplan_mode", "auto")
            timing_effort = options.get("timing_effort", "balanced")
            if floorplan_mode not in {"auto", "manual"}:
                raise ValueError("floorplan_mode must be auto or manual")
            if timing_effort not in {"balanced", "aggressive"}:
                raise ValueError("timing_effort must be balanced or aggressive")
            dimensions_valid = floorplan_mode == "auto" or (30 <= die_width <= 5000 and 30 <= die_height <= 5000)
            if not 0.1 <= clock_period <= 1000 or not dimensions_valid or not 5 <= utilization <= 80:
                raise ValueError("physical options are outside safe limits")
            validate_physical_top(sources, top, clock_port)
            supplied_sdc = options.get("sdc_content")
            if supplied_sdc is not None and not isinstance(supplied_sdc, str):
                raise ValueError("sdc_content must be text")
            if supplied_sdc and supplied_sdc.strip():
                validate_sdc_content(supplied_sdc)
                sdc_content = supplied_sdc.rstrip() + "\n"
                (job_dir / ".opensemilab-project-sdc").touch()
            else:
                sdc_content = physical_sdc(clock_port, clock_period)
            (job_dir / "constraints.sdc").write_text(sdc_content, encoding="utf-8")
            config = {
                "meta": {"version": 2, "flow": "Classic"},
                "PDK": pdk,
                "STD_CELL_LIBRARY": scl,
                "DESIGN_NAME": top,
                "VERILOG_FILES": [f"dir::{name}" for name in source_names],
                "CLOCK_PORT": clock_port,
                "CLOCK_PERIOD": clock_period,
                "PNR_SDC_FILE": "dir::constraints.sdc",
                "SIGNOFF_SDC_FILE": "dir::constraints.sdc",
                "FP_SIZING": "relative" if floorplan_mode == "auto" else "absolute",
                "FP_CORE_UTIL": utilization,
                "RUN_POST_GPL_DESIGN_REPAIR": True,
                "RUN_POST_CTS_RESIZER_TIMING": True,
            }
            if floorplan_mode == "manual":
                config["DIE_AREA"] = [0, 0, die_width, die_height]
            if timing_effort == "aggressive":
                config.update({
                    "RUN_POST_GRT_DESIGN_REPAIR": True,
                    "RUN_POST_GRT_RESIZER_TIMING": True,
                    "PL_RESIZER_SETUP_SLACK_MARGIN": 0.1,
                    "GRT_RESIZER_SETUP_SLACK_MARGIN": 0.05,
                })
            (job_dir / "physical-config.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
            command = [
                binary,
                "--pdk-root", pdk_root,
                "--pdk", pdk,
                "--scl", scl,
                "--save-views-to", "final",
                "physical-config.json",
            ]
            result = run_streaming_command(
                command,
                job_dir,
                PHYSICAL_TIMEOUT_SECONDS,
                PHYSICAL_IDLE_TIMEOUT_SECONDS,
                env_overrides={"PDK": pdk, "STD_CELL_LIBRARY": scl},
                progress_callback=progress_callback,
                cancel_event=cancel_event,
            )
            diagnostics: list[dict[str, str]] = []
            try:
                artifacts = physical_artifacts(job_dir)
            except Exception as error:
                artifacts = []
                diagnostics.append({"phase": "artifact_collection", "error": f"{type(error).__name__}: {error}"})
            try:
                layout = compact_def_layout(job_dir)
                if layout:
                    artifacts.insert(0, text_artifact("layout-summary.json", json.dumps(layout, separators=(",", ":")), "application/json"))
            except Exception as error:
                diagnostics.append({"phase": "layout_compaction", "error": f"{type(error).__name__}: {error}"})
            try:
                summary = physical_summary(job_dir, config)
            except Exception as error:
                summary = {
                    "schema": "opensemilab.physical-summary/v1", "pdk": pdk, "scl": scl,
                    "die_area_um2": die_width * die_height, "target_utilization_pct": utilization,
                    "clock_period_ns": clock_period, "cell_count": None, "wns_ns": None, "tns_ns": None,
                    "drc_violations": None, "estimated_critical_path_ns": None,
                    "estimated_max_frequency_mhz": None, "recommended_period_ns": None,
                }
                diagnostics.append({"phase": "metric_parsing", "error": f"{type(error).__name__}: {error}"})
            log_diagnostics = classify_physical_log(result["output"])
            diagnostic_payload = {
                "schema": "opensemilab.execution-diagnostics/v1",
                "stage": result.get("stage"), "tool": result.get("tool"),
                "postprocessing_errors": diagnostics,
                "log": log_diagnostics,
            }
            try:
                handoff_manifest = integration_manifest(job_dir, config)
            except Exception as error:
                handoff_manifest = {"schema": "opensemilab.integration-manifest/v1", "files": [], "error": f"{type(error).__name__}: {error}"}
                diagnostics.append({"phase": "integration_manifest", "error": handoff_manifest["error"]})
            summary_content = json.dumps(summary, indent=2) + "\n"
            readiness_content = json.dumps(summary.get("tapeout_readiness", {
                "schema": "opensemilab.tapeout-readiness/v1", "status": "review", "production_ready": False,
                "checks": [], "disclaimer": "Metric parsing failed; manual review is required.",
            }), indent=2) + "\n"
            manifest_content = json.dumps(handoff_manifest, indent=2) + "\n"
            diagnostics_content = json.dumps(diagnostic_payload, indent=2) + "\n"
            try:
                bundle = signoff_bundle(
                    job_dir, json.dumps(config, indent=2) + "\n", sdc_content,
                    summary_content, diagnostics_content, result["output"], readiness_content, manifest_content,
                )
                if bundle:
                    artifacts.insert(0, bundle)
                else:
                    diagnostics.append({"phase": "signoff_bundle", "error": f"compressed package exceeded {MAX_SIGNOFF_BUNDLE_BYTES} bytes"})
            except Exception as error:
                diagnostics.append({"phase": "signoff_bundle", "error": f"{type(error).__name__}: {error}"})
            artifacts.insert(0, text_artifact("execution-diagnostics.json", diagnostics_content, "application/json"))
            artifacts.insert(0, text_artifact("execution.log", result["output"]))
            artifacts.insert(0, text_artifact("physical-summary.json", summary_content, "application/json"))
            artifacts.insert(0, text_artifact("tapeout-readiness.json", readiness_content, "application/json"))
            artifacts.insert(0, text_artifact("integration-manifest.json", manifest_content, "application/json"))
            artifacts.insert(0, text_artifact("constraints.sdc", sdc_content, "text/x-sdc"))
            artifacts.insert(0, {"name": "physical-config.json", "media_type": "application/json", "encoding": "utf-8", "content": json.dumps(config, indent=2) + "\n", "size_bytes": len(json.dumps(config))})
            return {
                "job_id": job_id,
                "action": action,
                "engine": "LibreLane/OpenROAD",
                "pdk": pdk,
                "scl": scl,
                "summary": summary,
                "diagnostics": diagnostic_payload,
                "success": result["exit_code"] == 0,
                **result,
                "artifacts": artifacts,
            }
        if action == "spice":
            if not shutil.which(TOOL_BINARIES["ngspice"]):
                raise RuntimeError("ngspice is unavailable after IIC-OSIC environment initialization")
            entry = payload.get("entry")
            if not isinstance(entry, str) or entry not in sources:
                raise ValueError("entry must identify one of the supplied SPICE files")
            result = run_command([TOOL_BINARIES["ngspice"], "-b", "-o", "spice.log", entry], job_dir)
            log_path = job_dir / "spice.log"
            log = log_path.read_text(encoding="utf-8", errors="replace") if log_path.exists() else result["output"]
            result["output"] = log[-MAX_OUTPUT:]
            artifacts = []
            if log_path.exists():
                artifacts.append(text_artifact("spice.log", log[-MAX_OUTPUT:]))
            simulation_data = parse_spice_tables(log)
            if simulation_data["plots"]:
                data_content = json.dumps(simulation_data, separators=(",", ":"))
                artifacts.insert(0, text_artifact("simulation-data.json", data_content, "application/json"))
            return {"job_id": job_id, "action": action, "engine": "ngspice", "success": result["exit_code"] == 0, **result, "simulation": simulation_data, "artifacts": artifacts}
        if action == "vhdl":
            binary = TOOL_BINARIES["ghdl"]
            if not shutil.which(binary):
                raise RuntimeError("GHDL is unavailable after IIC-OSIC environment initialization")
            analyze = run_command([binary, "-a", "--std=08", *source_names], job_dir)
            if analyze["exit_code"] != 0:
                return {"job_id": job_id, "action": action, "engine": "GHDL", "success": False, **analyze, "artifacts": []}
            elaborate = run_command([binary, "-e", "--std=08", top], job_dir)
            if elaborate["exit_code"] != 0:
                elaborate["output"] = "ANALYZE\n" + analyze["output"] + "\nELABORATE\n" + elaborate["output"]
                elaborate["duration_ms"] += analyze["duration_ms"]
                return {"job_id": job_id, "action": action, "engine": "GHDL", "success": False, **elaborate, "artifacts": []}
            result = run_command([binary, "-r", "--std=08", top, "--vcd=waveform.vcd", "--stop-time=1ms"], job_dir)
            result["output"] = "ANALYZE\n" + analyze["output"] + "\nELABORATE\n" + elaborate["output"] + "\nSIMULATION\n" + result["output"]
            result["duration_ms"] += analyze["duration_ms"] + elaborate["duration_ms"]
            artifacts = []
            waveform = job_dir / "waveform.vcd"
            if waveform.exists() and waveform.stat().st_size <= MAX_WAVEFORM_BYTES:
                artifacts.append(text_artifact("waveform.vcd", waveform.read_text(encoding="utf-8", errors="replace"), "text/x-vcd"))
            return {"job_id": job_id, "action": action, "engine": "GHDL", "success": result["exit_code"] == 0, **result, "artifacts": artifacts}
        if action == "lint":
            binary = TOOL_BINARIES["verible_lint"]
            if shutil.which(binary):
                command = [binary, "--ruleset=default", *source_names]
                engine = "verible-verilog-lint"
            else:
                if not shutil.which(TOOL_BINARIES["verilator"]):
                    raise RuntimeError("neither Verible nor Verilator is available after IIC-OSIC environment initialization")
                command = [TOOL_BINARIES["verilator"], "--lint-only", "--Wall", "-Wno-fatal", "--top-module", top, *source_names]
                engine = "verilator"
        elif action == "simulate":
            if not shutil.which(TOOL_BINARIES["iverilog"]) or not shutil.which(TOOL_BINARIES["vvp"]):
                raise RuntimeError("Icarus Verilog (iverilog/vvp) is unavailable after IIC-OSIC environment initialization")
            roots = ["-s", top]
            if not any("$dumpfile" in content for content in sources.values()):
                probe_name = "__opensemilab_wave_probe"
                probe_file = "__opensemilab_wave_probe.sv"
                (job_dir / probe_file).write_text(
                    f'module {probe_name}; initial begin $dumpfile("waveform.vcd"); $dumpvars(0, {top}); end endmodule\n',
                    encoding="utf-8",
                )
                roots.extend(["-s", probe_name])
                source_names.append(probe_file)
            command = [TOOL_BINARIES["iverilog"], "-g2012", *roots, "-o", "simulation.vvp", *source_names]
            compile_result = run_command(command, job_dir)
            if compile_result["exit_code"] != 0:
                return {"job_id": job_id, "action": action, "engine": "iverilog", "success": False, **compile_result, "artifacts": []}
            result = run_command([TOOL_BINARIES["vvp"], "simulation.vvp"], job_dir)
            result["output"] = "COMPILE\n" + compile_result["output"] + "\nSIMULATION\n" + result["output"]
            result["duration_ms"] += compile_result["duration_ms"]
            artifacts = []
            vcd_files = sorted(job_dir.rglob("*.vcd"), key=lambda path: path.stat().st_size)
            if vcd_files:
                waveform = vcd_files[0]
                if waveform.stat().st_size <= MAX_WAVEFORM_BYTES:
                    artifacts.append(text_artifact("waveform.vcd", waveform.read_text(encoding="utf-8", errors="replace"), "text/x-vcd"))
                else:
                    result["output"] += f"\nWaveform omitted because it exceeds {MAX_WAVEFORM_BYTES // 1_000_000} MB."
            return {"job_id": job_id, "action": action, "engine": "iverilog/vvp", "success": result["exit_code"] == 0, **result, "artifacts": artifacts}
        else:
            if not shutil.which(TOOL_BINARIES["yosys"]):
                raise RuntimeError("Yosys is unavailable after IIC-OSIC environment initialization")
            script = f"read_verilog -sv {' '.join(source_names)}; hierarchy -check -top {top}; proc; opt; check; stat; write_json netlist.json"
            command = [TOOL_BINARIES["yosys"], "-p", script]
            engine = "yosys"

        result = run_command(command, job_dir)
        artifacts = []
        if action == "synthesize" and (job_dir / "netlist.json").exists() and result["exit_code"] == 0:
            content = (job_dir / "netlist.json").read_text(encoding="utf-8")
            artifacts.append({"name": "netlist.json", "media_type": "application/json", "content": content[:MAX_OUTPUT]})
        return {"job_id": job_id, "action": action, "engine": engine, "success": result["exit_code"] == 0, **result, "artifacts": artifacts}
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(200, capabilities())
        elif self.path.startswith("/jobs/"):
            job_id = self.path.removeprefix("/jobs/").split("?", 1)[0]
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                body = dict(job) if job else None
            self.send_json(200, body) if body else self.send_json(404, {"error": "job not found"})
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        cancel_match = re.fullmatch(r"/jobs/([A-Za-z0-9]{1,32})/cancel", self.path)
        if cancel_match:
            job_id = cancel_match.group(1)
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                event = JOB_CANCEL_EVENTS.get(job_id)
                if job is None:
                    self.send_json(404, {"error": "job not found"}); return
                if job.get("status") not in {"queued", "running"} or event is None:
                    self.send_json(409, {"error": "job is no longer active"}); return
                event.set()
                job["cancellation_requested_at"] = time.time()
            self.send_json(202, {"job_id": job_id, "status": "cancelling"}); return
        if self.path not in {"/run", "/jobs"}:
            self.send_json(404, {"error": "not found"}); return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                raise ValueError("invalid request size")
            payload = json.loads(self.rfile.read(length))
            if self.path == "/jobs":
                if payload.get("action") != "physical":
                    raise ValueError("only physical implementation uses asynchronous jobs")
                job_id = uuid.uuid4().hex[:12]
                with JOBS_LOCK:
                    if any(job.get("status") in {"queued", "running"} for job in JOBS.values()):
                        raise RuntimeError("another physical implementation job is already active")
                    if len(JOBS) >= 5:
                        terminal = [key for key, job in JOBS.items() if job.get("status") in {"completed", "failed", "cancelled"}]
                        if terminal:
                            oldest = min(terminal, key=lambda key: JOBS[key].get("created_at", 0))
                            JOBS.pop(oldest, None)
                    JOBS[job_id] = {
                        "job_id": job_id,
                        "action": "physical",
                        "status": "queued",
                        "created_at": time.time(),
                        "heartbeat_at": time.time(),
                        "elapsed_seconds": 0,
                        "last_output_seconds_ago": 0,
                        "live_output": "",
                        "process_alive": False,
                    }
                    JOB_CANCEL_EVENTS[job_id] = threading.Event()
                threading.Thread(target=run_background_job, args=(job_id, payload), daemon=True).start()
                self.send_json(202, {"job_id": job_id, "action": "physical", "status": "queued"})
            else:
                self.send_json(200, execute(payload))
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": str(error)})
        except RuntimeError as error:
            self.send_json(409, {"error": str(error)})
        except Exception as error:
            self.send_json(500, {"error": f"worker failure: {error}"})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"worker {self.address_string()} {format % args}", flush=True)


def run_background_job(job_id: str, payload: dict[str, Any]) -> None:
    with JOBS_LOCK:
        JOBS[job_id]["status"] = "running"
        JOBS[job_id]["started_at"] = time.time()
    try:
        def report_progress(progress: dict[str, Any]) -> None:
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                if job is not None:
                    job.update(progress)
                    job["heartbeat_at"] = time.time()

        result = execute(payload, progress_callback=report_progress, cancel_event=JOB_CANCEL_EVENTS[job_id])
        result["job_id"] = job_id
        status = "cancelled" if result.get("cancelled") else ("completed" if result["success"] else "failed")
        with JOBS_LOCK:
            JOBS[job_id].update(status=status, result=result, process_alive=False, finished_at=time.time())
    except Exception as error:
        diagnostic = "".join(traceback.format_exception(type(error), error, error.__traceback__))
        with JOBS_LOCK:
            job = JOBS[job_id]
            live_output = str(job.get("live_output", ""))
            message = f"{type(error).__name__}: {error}"
            output = (live_output + ("\n" if live_output else "") + f"[OpenSemiLab] Internal failure after the last captured output: {message}")[-MAX_OUTPUT:]
            fallback = {
                "job_id": job_id, "action": "physical", "engine": "LibreLane/OpenROAD",
                "success": False, "exit_code": 70, "output": output,
                "duration_ms": round(float(job.get("elapsed_seconds", 0)) * 1000),
                "artifacts": [
                    text_artifact("execution.log", output),
                    text_artifact("execution-diagnostics.txt", diagnostic),
                ],
                "diagnostics": {"schema": "opensemilab.execution-diagnostics/v1", "internal_error": message},
            }
            job.update(status="failed", error=message, result=fallback, process_alive=False, finished_at=time.time())
    finally:
        with JOBS_LOCK:
            JOB_CANCEL_EVENTS.pop(job_id, None)


if __name__ == "__main__":
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    print(f"OpenSemiLab IIC-OSIC worker listening on {HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
