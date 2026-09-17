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
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from typing import Any

HOST = "0.0.0.0"
PORT = int(os.getenv("OPENSEMILAB_WORKER_PORT", "9000"))
WORK_ROOT = Path(os.getenv("OPENSEMILAB_WORK_ROOT", "/tmp/opensemilab-jobs"))
MAX_BODY = 512_000
MAX_OUTPUT = 200_000
TIMEOUT_SECONDS = int(os.getenv("OPENSEMILAB_JOB_TIMEOUT", "90"))
SAFE_PATH_COMPONENT = re.compile(r"^[A-Za-z0-9_.-]+$")

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
    }
    return {
        "worker": "iic-osic-tools",
        "worker_version": "0.2.0",
        "ready": all(actions.values()),
        "actions": actions,
        "tools": tools,
        "environment": {
            "tools_root": os.getenv("TOOLS"),
            "pdk_root": os.getenv("PDK_ROOT") or os.getenv("PDKPATH"),
        },
    }


def validate_sources(raw: Any) -> dict[str, str]:
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
        if Path(filename).suffix not in {".v", ".sv", ".vh", ".svh"}:
            raise ValueError(f"unsupported source type: {filename}")
        if not isinstance(content, str):
            raise ValueError(f"source must be text: {filename}")
        total += len(content.encode())
        if total > 256_000:
            raise ValueError("source bundle exceeds 256 KB")
        clean[filename] = content
    return clean


def run_command(command: list[str], cwd: Path) -> dict[str, Any]:
    started = time.monotonic()
    try:
        process = subprocess.run(command, cwd=cwd, text=True, capture_output=True, timeout=TIMEOUT_SECONDS, env={**os.environ, "HOME": str(cwd)})
        output = (process.stdout + ("\n" if process.stdout and process.stderr else "") + process.stderr)[-MAX_OUTPUT:]
        return {"exit_code": process.returncode, "output": output, "duration_ms": round((time.monotonic() - started) * 1000), "timed_out": False}
    except subprocess.TimeoutExpired as error:
        output = ((error.stdout or "") + (error.stderr or ""))[-MAX_OUTPUT:]
        return {"exit_code": 124, "output": output + f"\nTimed out after {TIMEOUT_SECONDS}s", "duration_ms": round((time.monotonic() - started) * 1000), "timed_out": True}


def execute(payload: dict[str, Any]) -> dict[str, Any]:
    action = payload.get("action")
    if action not in {"lint", "simulate", "synthesize"}:
        raise ValueError("action must be lint, simulate, or synthesize")
    sources = validate_sources(payload.get("sources"))
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
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/run":
            self.send_json(404, {"error": "not found"}); return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                raise ValueError("invalid request size")
            payload = json.loads(self.rfile.read(length))
            self.send_json(200, execute(payload))
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": str(error)})
        except RuntimeError as error:
            self.send_json(409, {"error": str(error)})
        except Exception as error:
            self.send_json(500, {"error": f"worker failure: {error}"})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"worker {self.address_string()} {format % args}", flush=True)


if __name__ == "__main__":
    WORK_ROOT.mkdir(parents=True, exist_ok=True)
    print(f"OpenSemiLab IIC-OSIC worker listening on {HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
