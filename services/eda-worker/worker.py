"""Constrained HTTP bridge to command-line tools in IIC-OSIC-TOOLS.

This service intentionally exposes named workflows rather than a shell.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from base64 import b64encode
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from typing import Any

HOST = "0.0.0.0"
PORT = int(os.getenv("OPENSEMILAB_WORKER_PORT", "9000"))
WORK_ROOT = Path(os.getenv("OPENSEMILAB_WORK_ROOT", "/tmp/opensemilab-jobs"))
MAX_BODY = 512_000
MAX_OUTPUT = 200_000
TIMEOUT_SECONDS = int(os.getenv("OPENSEMILAB_JOB_TIMEOUT", "90"))
PHYSICAL_TIMEOUT_SECONDS = int(os.getenv("OPENSEMILAB_PHYSICAL_TIMEOUT", "1800"))
SAFE_PATH_COMPONENT = re.compile(r"^[A-Za-z0-9_.-]+$")
MAX_ARTIFACT_BYTES = 20_000_000
MAX_ARTIFACT_BUNDLE_BYTES = 40_000_000
JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()

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
}


def capabilities() -> dict[str, Any]:
    tools = {}
    for name, binary in TOOL_BINARIES.items():
        path = shutil.which(binary)
        tools[name] = {"available": path is not None, "binary": binary, "path": path}

    actions = {
        "lint": tools["verible_lint"]["available"] or tools["verilator"]["available"],
        "simulate": tools["iverilog"]["available"] and tools["vvp"]["available"],
        "synthesize": tools["yosys"]["available"],
        "spice": tools["ngspice"]["available"],
        "physical": tools["librelane"]["available"] and bool(os.getenv("PDK_ROOT") or os.getenv("PDKPATH")),
    }
    return {
        "worker": "iic-osic-tools",
        "worker_version": "0.2.0",
        "ready": all(actions[name] for name in ("lint", "simulate", "synthesize")),
        "all_actions_ready": all(actions.values()),
        "actions": actions,
        "tools": tools,
        "environment": {
            "tools_root": os.getenv("TOOLS"),
            "pdk_root": os.getenv("PDK_ROOT") or os.getenv("PDKPATH"),
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
        allowed_suffixes = {".spice", ".cir", ".ckt", ".lib"} if action == "spice" else {".v", ".sv", ".vh", ".svh"}
        if Path(filename).suffix.lower() not in allowed_suffixes:
            raise ValueError(f"unsupported source type: {filename}")
        if not isinstance(content, str):
            raise ValueError(f"source must be text: {filename}")
        total += len(content.encode())
        if total > 256_000:
            raise ValueError("source bundle exceeds 256 KB")
        clean[filename] = content
    return clean


def run_command(command: list[str], cwd: Path, timeout_seconds: int = TIMEOUT_SECONDS) -> dict[str, Any]:
    started = time.monotonic()
    try:
        process = subprocess.run(command, cwd=cwd, text=True, capture_output=True, timeout=timeout_seconds, env={**os.environ, "HOME": str(cwd)})
        output = (process.stdout + ("\n" if process.stdout and process.stderr else "") + process.stderr)[-MAX_OUTPUT:]
        return {"exit_code": process.returncode, "output": output, "duration_ms": round((time.monotonic() - started) * 1000), "timed_out": False}
    except subprocess.TimeoutExpired as error:
        output = ((error.stdout or "") + (error.stderr or ""))[-MAX_OUTPUT:]
        return {"exit_code": 124, "output": output + f"\nTimed out after {timeout_seconds}s", "duration_ms": round((time.monotonic() - started) * 1000), "timed_out": True}


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
    for path in candidates:
        size = path.stat().st_size
        if size > MAX_ARTIFACT_BYTES or total + size > MAX_ARTIFACT_BUNDLE_BYTES:
            continue
        relative = path.relative_to(job_dir).as_posix()
        if relative in seen_names:
            continue
        seen_names.add(relative)
        raw = path.read_bytes()
        binary = path.suffix.lower() == ".gds"
        artifacts.append({
            "name": relative,
            "media_type": "application/octet-stream" if binary else "text/plain",
            "encoding": "base64" if binary else "utf-8",
            "content": b64encode(raw).decode("ascii") if binary else raw.decode("utf-8", errors="replace"),
            "size_bytes": size,
        })
        total += size
    return artifacts


def execute(payload: dict[str, Any]) -> dict[str, Any]:
    action = payload.get("action")
    if action not in {"lint", "simulate", "synthesize", "spice", "physical"}:
        raise ValueError("action must be lint, simulate, synthesize, spice, or physical")
    sources = validate_sources(payload.get("sources"), action)
    top = payload.get("top", "top")
    if not isinstance(top, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$]*", top):
        raise ValueError("invalid top module")

    job_id = uuid.uuid4().hex[:12]
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    job_dir = Path(tempfile.mkdtemp(prefix=f"job-{job_id}-", dir=WORK_ROOT))
    try:
        for filename, content in sources.items():
            destination = job_dir / filename
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(content, encoding="utf-8")
        source_names = sorted(sources)
        if action == "physical":
            binary = TOOL_BINARIES["librelane"]
            if not shutil.which(binary):
                raise RuntimeError("LibreLane is unavailable after IIC-OSIC environment initialization")
            pdk_root = os.getenv("PDK_ROOT") or os.getenv("PDKPATH")
            if not pdk_root:
                raise RuntimeError("PDK_ROOT is not configured in the IIC-OSIC environment")
            options = payload.get("physical")
            if not isinstance(options, dict):
                raise ValueError("physical options are required")
            pdk = options.get("pdk")
            if pdk not in {"sky130A", "gf180mcuD"}:
                raise ValueError("physical implementation currently supports sky130A and gf180mcuD")
            clock_port = options.get("clock_port", "clk")
            if not isinstance(clock_port, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$]*", clock_port):
                raise ValueError("invalid clock port")
            clock_period = float(options.get("clock_period_ns", 10.0))
            die_width = float(options.get("die_width_um", 120.0))
            die_height = float(options.get("die_height_um", 120.0))
            utilization = float(options.get("core_utilization_pct", 40.0))
            if not 0.1 <= clock_period <= 1000 or not 30 <= die_width <= 5000 or not 30 <= die_height <= 5000 or not 5 <= utilization <= 80:
                raise ValueError("physical options are outside safe limits")
            config = {
                "meta": {"version": 2, "flow": "Classic"},
                "PDK": pdk,
                "DESIGN_NAME": top,
                "VERILOG_FILES": [f"dir::{name}" for name in source_names],
                "CLOCK_PORT": clock_port,
                "CLOCK_PERIOD": clock_period,
                "FP_SIZING": "absolute",
                "DIE_AREA": [0, 0, die_width, die_height],
                "FP_CORE_UTIL": utilization,
            }
            (job_dir / "physical-config.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
            command = [binary, "--pdk-root", pdk_root, "--save-views-to", "final", "physical-config.json"]
            result = run_command(command, job_dir, PHYSICAL_TIMEOUT_SECONDS)
            artifacts = physical_artifacts(job_dir)
            artifacts.insert(0, {"name": "physical-config.json", "media_type": "application/json", "encoding": "utf-8", "content": json.dumps(config, indent=2) + "\n", "size_bytes": len(json.dumps(config))})
            return {"job_id": job_id, "action": action, "engine": "LibreLane/OpenROAD", "success": result["exit_code"] == 0, **result, "artifacts": artifacts}
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
                artifacts.append({"name": "spice.log", "media_type": "text/plain", "content": log[-MAX_OUTPUT:]})
            return {"job_id": job_id, "action": action, "engine": "ngspice", "success": result["exit_code"] == 0, **result, "artifacts": artifacts}
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
            command = [TOOL_BINARIES["iverilog"], "-g2012", "-s", top, "-o", "simulation.vvp", *source_names]
            compile_result = run_command(command, job_dir)
            if compile_result["exit_code"] != 0:
                return {"job_id": job_id, "action": action, "engine": "iverilog", "success": False, **compile_result, "artifacts": []}
            result = run_command([TOOL_BINARIES["vvp"], "simulation.vvp"], job_dir)
            result["output"] = "COMPILE\n" + compile_result["output"] + "\nSIMULATION\n" + result["output"]
            result["duration_ms"] += compile_result["duration_ms"]
            return {"job_id": job_id, "action": action, "engine": "iverilog/vvp", "success": result["exit_code"] == 0, **result, "artifacts": []}
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
                        terminal = [key for key, job in JOBS.items() if job.get("status") in {"completed", "failed"}]
                        if terminal:
                            oldest = min(terminal, key=lambda key: JOBS[key].get("created_at", 0))
                            JOBS.pop(oldest, None)
                    JOBS[job_id] = {"job_id": job_id, "action": "physical", "status": "queued", "created_at": time.time()}
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
        result = execute(payload)
        with JOBS_LOCK:
            JOBS[job_id].update(status="completed" if result["success"] else "failed", result=result, finished_at=time.time())
    except Exception as error:
        with JOBS_LOCK:
            JOBS[job_id].update(status="failed", error=str(error), finished_at=time.time())


if __name__ == "__main__":
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    print(f"OpenSemiLab IIC-OSIC worker listening on {HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
