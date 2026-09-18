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
MAX_WAVEFORM_BYTES = 5_000_000
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
    "xyce": ("available", "Alternative parallel SPICE"),
    "openems": ("available", "RF electromagnetic simulation"),
    "xschem": ("available", "Schematic editor; GUI adapter required"),
    "gtkwave": ("available", "Waveform GUI; browser viewer is connected instead"),
    "sby": ("available", "Formal verification"),
    "nextpnr_ice40": ("available", "FPGA place and route"),
    "gds3d": ("available", "Native GDS 3D viewer"),
    "cace": ("available", "Circuit characterization"),
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
    }
    return {
        "worker": "iic-osic-tools",
        "worker_version": "0.2.0",
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
        if action == "spice":
            allowed_suffixes = {".spice", ".cir", ".ckt", ".lib"}
        elif action == "vhdl":
            allowed_suffixes = {".vhd", ".vhdl"}
        else:
            allowed_suffixes = {".v", ".sv", ".vh", ".svh"}
        if Path(filename).suffix.lower() not in allowed_suffixes:
            raise ValueError(f"unsupported source type: {filename}")
        if not isinstance(content, str):
            raise ValueError(f"source must be text: {filename}")
        total += len(content.encode())
        if total > 256_000:
            raise ValueError("source bundle exceeds 256 KB")
        clean[filename] = content
    return clean


def run_command(
    command: list[str],
    cwd: Path,
    timeout_seconds: int = TIMEOUT_SECONDS,
    env_overrides: dict[str, str] | None = None,
) -> dict[str, Any]:
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


def physical_summary(job_dir: Path, config: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "schema": "opensemilab.physical-summary/v1",
        "pdk": config["PDK"],
        "scl": config["STD_CELL_LIBRARY"],
        "die_area_um2": float(config["DIE_AREA"][2]) * float(config["DIE_AREA"][3]),
        "target_utilization_pct": float(config["FP_CORE_UTIL"]),
        "cell_count": None,
        "wns_ns": None,
        "tns_ns": None,
        "drc_violations": None,
    }
    text_files = [path for root in (job_dir / "final", job_dir / "runs") if root.exists() for path in root.rglob("*") if path.is_file() and path.suffix.lower() in {".def", ".rpt", ".log", ".csv", ".json"}]
    patterns = {
        "wns_ns": [r"timing__setup__wns[\s,:=]+(-?[0-9.eE+]+)", r"\bWNS\b[^-+0-9]*(-?[0-9.eE+]+)"],
        "tns_ns": [r"timing__setup__tns[\s,:=]+(-?[0-9.eE+]+)", r"\bTNS\b[^-+0-9]*(-?[0-9.eE+]+)"],
        "drc_violations": [r"route__drc_errors[\s,:=]+([0-9]+)", r"drc[^\n]{0,30}(?:violations|errors)[^0-9]*([0-9]+)"],
    }
    for path in text_files:
        if path.stat().st_size > 5_000_000:
            continue
        content = path.read_text(encoding="utf-8", errors="replace")
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
                    summary[key] = int(match.group(1)) if key == "drc_violations" else float(match.group(1))
                    break
    return summary


def execute(payload: dict[str, Any]) -> dict[str, Any]:
    action = payload.get("action")
    if action not in {"lint", "simulate", "synthesize", "spice", "vhdl", "physical"}:
        raise ValueError("action must be lint, simulate, synthesize, spice, vhdl, or physical")
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
            clock_period = float(options.get("clock_period_ns", 10.0))
            die_width = float(options.get("die_width_um", 120.0))
            die_height = float(options.get("die_height_um", 120.0))
            utilization = float(options.get("core_utilization_pct", 40.0))
            if not 0.1 <= clock_period <= 1000 or not 30 <= die_width <= 5000 or not 30 <= die_height <= 5000 or not 5 <= utilization <= 80:
                raise ValueError("physical options are outside safe limits")
            config = {
                "meta": {"version": 2, "flow": "Classic"},
                "PDK": pdk,
                "STD_CELL_LIBRARY": scl,
                "DESIGN_NAME": top,
                "VERILOG_FILES": [f"dir::{name}" for name in source_names],
                "CLOCK_PORT": clock_port,
                "CLOCK_PERIOD": clock_period,
                "FP_SIZING": "absolute",
                "DIE_AREA": [0, 0, die_width, die_height],
                "FP_CORE_UTIL": utilization,
            }
            (job_dir / "physical-config.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
            command = [
                binary,
                "--pdk-root", pdk_root,
                "--pdk", pdk,
                "--scl", scl,
                "--save-views-to", "final",
                "physical-config.json",
            ]
            result = run_command(
                command,
                job_dir,
                PHYSICAL_TIMEOUT_SECONDS,
                env_overrides={"PDK": pdk, "STD_CELL_LIBRARY": scl},
            )
            artifacts = physical_artifacts(job_dir)
            summary = physical_summary(job_dir, config)
            summary_content = json.dumps(summary, indent=2) + "\n"
            artifacts.insert(0, text_artifact("physical-summary.json", summary_content, "application/json"))
            artifacts.insert(0, {"name": "physical-config.json", "media_type": "application/json", "encoding": "utf-8", "content": json.dumps(config, indent=2) + "\n", "size_bytes": len(json.dumps(config))})
            return {
                "job_id": job_id,
                "action": action,
                "engine": "LibreLane/OpenROAD",
                "pdk": pdk,
                "scl": scl,
                "summary": summary,
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
