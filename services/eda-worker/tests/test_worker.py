import importlib.util
import base64
import io
import tempfile
import threading
import time
import unittest
import zipfile
from base64 import b64encode
from pathlib import Path
from unittest.mock import patch


WORKER_PATH = Path(__file__).resolve().parents[1] / "worker.py"
SPEC = importlib.util.spec_from_file_location("opensemilab_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(worker)


class WorkerResultTests(unittest.TestCase):
    def test_streaming_command_has_no_total_limit_and_reports_liveness(self):
        updates = []
        with tempfile.TemporaryDirectory() as temporary:
            result = worker.run_streaming_command(
                ["python3", "-u", "-c", "import time; print('stage one'); time.sleep(1.1); print('stage two')"],
                Path(temporary),
                timeout_seconds=0,
                idle_timeout_seconds=10,
                progress_callback=updates.append,
            )

        self.assertEqual(result["exit_code"], 0)
        self.assertFalse(result["timed_out"])
        self.assertIn("stage one", result["output"])
        self.assertIn("stage two", result["output"])
        self.assertTrue(any(update["process_alive"] for update in updates))
        self.assertTrue(any("stage one" in update["live_output"] for update in updates))

    def test_streaming_command_cancels_process_group_without_reporting_timeout(self):
        cancel = threading.Event()
        threading.Thread(target=lambda: (time.sleep(0.2), cancel.set()), daemon=True).start()
        with tempfile.TemporaryDirectory() as temporary:
            result = worker.run_streaming_command(
                ["python3", "-u", "-c", "import time; print('started'); time.sleep(30)"],
                Path(temporary), idle_timeout_seconds=60, cancel_event=cancel,
            )

        self.assertEqual(result["exit_code"], 130)
        self.assertTrue(result["cancelled"])
        self.assertFalse(result["timed_out"])
        self.assertIn("Cancelled by the user", result["output"])

    def test_run_command_decodes_partial_byte_output_on_timeout(self):
        timeout = worker.subprocess.TimeoutExpired(
            cmd=["librelane"],
            timeout=30,
            output=b"partial stdout\n",
            stderr=b"partial stderr\n",
        )
        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(worker.subprocess, "run", side_effect=timeout):
                result = worker.run_command(["librelane"], Path(temporary), timeout_seconds=30)

        self.assertEqual(result["exit_code"], 124)
        self.assertTrue(result["timed_out"])
        self.assertIn("partial stdout", result["output"])
        self.assertIn("partial stderr", result["output"])
        self.assertIn("Timed out after 30s", result["output"])

    def test_capabilities_explain_integration_level(self):
        with patch.object(worker.shutil, "which", return_value="/usr/bin/tool"):
            data = worker.capabilities()
        integrations = {item["tool"]: item["level"] for item in data["integrations"]}
        self.assertEqual(integrations["ghdl"], "direct")
        self.assertEqual(integrations["openroad"], "orchestrated")
        self.assertEqual(integrations["openems"], "direct")
        self.assertEqual(integrations["sby"], "direct")
        self.assertTrue(data["actions"]["gds3d"])

    def test_ngspice_print_table_becomes_chart_series(self):
        log = """
Index   v-sweep   v(a)       v(y)
----------------------------------
0       0.0       0.0        1.8
1       0.9       0.9        0.9
2       1.8       1.8        0.0
"""
        data = worker.parse_spice_tables(log)
        self.assertEqual(data["schema"], "opensemilab.simulation/v1")
        self.assertEqual(len(data["plots"]), 1)
        self.assertEqual(data["plots"][0]["series"][1]["name"], "v(y)")
        self.assertEqual(data["plots"][0]["series"][1]["y"], [1.8, 0.9, 0.0])

    def test_iverilog_simulation_injects_and_collects_vcd(self):
        payload = {
            "action": "simulate",
            "top": "tb_top",
            "sources": {
                "rtl/top.sv": "module top(input logic a, output logic y); assign y=a; endmodule\n",
                "verification/tb_top.sv": "module tb_top; logic a,y; top dut(.*); initial begin a=0; #1 a=1; #1 $finish; end endmodule\n",
            },
        }
        with tempfile.TemporaryDirectory() as temporary:
            original_root = worker.WORK_ROOT
            worker.WORK_ROOT = Path(temporary)
            commands = []

            def fake_run(command, cwd, timeout_seconds=worker.TIMEOUT_SECONDS, env_overrides=None):
                commands.append(command)
                if command[0] == worker.TOOL_BINARIES["vvp"]:
                    (cwd / "waveform.vcd").write_text("$timescale 1ns $end\n#0\n0!\n#1\n1!\n", encoding="utf-8")
                return {"exit_code": 0, "output": "ok", "duration_ms": 1, "timed_out": False}

            try:
                with patch.object(worker.shutil, "which", return_value="/usr/bin/tool"), patch.object(worker, "run_command", side_effect=fake_run):
                    result = worker.execute(payload)
            finally:
                worker.WORK_ROOT = original_root

        self.assertTrue(result["success"])
        self.assertIn("__opensemilab_wave_probe.sv", commands[0])
        self.assertTrue(any(artifact["name"] == "waveform.vcd" for artifact in result["artifacts"]))

    def test_physical_summary_reads_def_and_metrics(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary)
            final = job / "final"
            final.mkdir()
            (final / "design.def").write_text("COMPONENTS 42 ;\nEND COMPONENTS\n", encoding="utf-8")
            (final / "metrics.csv").write_text(
                "timing__setup__wns,-0.125\ntiming__setup__tns,-1.75\nroute__drc_errors,3\n",
                encoding="utf-8",
            )
            summary = worker.physical_summary(job, {
                "PDK": "gf180mcuD",
                "STD_CELL_LIBRARY": "gf180mcu_fd_sc_mcu7t5v0",
                "DIE_AREA": [0, 0, 120, 100],
                "FP_CORE_UTIL": 40,
            })

        self.assertEqual(summary["cell_count"], 42)
        self.assertEqual(summary["wns_ns"], -0.125)
        self.assertEqual(summary["tns_ns"], -1.75)
        self.assertEqual(summary["drc_violations"], 3)
        self.assertEqual(summary["die_area_um2"], 12000)
        self.assertAlmostEqual(summary["estimated_critical_path_ns"], 10.125)
        self.assertEqual(summary["recommended_period_ns"], 11.0)

    def test_physical_sdc_and_preflight_use_the_selected_clock(self):
        sources = {"rtl/top.sv": "module top(input logic clk, input logic resetn); endmodule\n"}
        worker.validate_physical_top(sources, "top", "clk")
        sdc = worker.physical_sdc("clk", 25.0)
        self.assertIn("create_clock -name {clk} -period 25", sdc)
        self.assertIn("set_clock_uncertainty 0.125", sdc)
        with self.assertRaisesRegex(ValueError, "clock port 'missing'"):
            worker.validate_physical_top(sources, "top", "missing")
        worker.validate_sdc_content("create_clock -period 25 [get_ports clk]\n")
        with self.assertRaisesRegex(ValueError, "not allowed"):
            worker.validate_sdc_content("[exec id]\n")

    def test_compact_def_layout_keeps_a_bounded_visualization(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary)
            final = job / "final"
            final.mkdir()
            (final / "top.def").write_text(
                "VERSION 5.8 ;\nUNITS DISTANCE MICRONS 1000 ;\nDIEAREA ( 0 0 ) ( 120000 100000 ) ;\n"
                "COMPONENTS 1 ;\n- cpu sky130_cell + PLACED ( 1000 2000 ) N ;\nEND COMPONENTS\n"
                "NETS 1 ;\n- clk + ROUTED met1 ( 0 0 ) ( 1000 * ) ( * 2000 ) ;\nEND NETS\nEND DESIGN\n",
                encoding="utf-8",
            )
            layout = worker.compact_def_layout(job)

        self.assertIsNotNone(layout)
        self.assertEqual(layout["width"], 120)
        self.assertEqual(layout["component_count"], 1)
        self.assertEqual(layout["components"][0]["name"], "cpu")
        self.assertEqual(len(layout["layers"][0]["segments"]), 2)

    def test_large_def_is_embedded_as_gzip_with_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary)
            final = job / "final"
            final.mkdir()
            (final / "top.def").write_bytes(b"A" * 1024)
            with patch.object(worker, "MAX_ARTIFACT_BYTES", 100), patch.object(worker, "MAX_ARTIFACT_BUNDLE_BYTES", 1000):
                artifacts = worker.physical_artifacts(job)

        self.assertTrue(any(item["name"] == "final/top.def.gz" for item in artifacts))
        self.assertTrue(any(item["name"] == "artifact-manifest.json" for item in artifacts))

    def test_signoff_bundle_is_compressed_and_grouped(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary)
            final = job / "final"
            final.mkdir()
            (final / "top.gds").write_bytes(b"gds" * 100)
            (final / "top.pnl.v").write_text("module top; endmodule\n", encoding="utf-8")
            (final / "top.spef").write_text("*SPEF test\n", encoding="utf-8")
            bundle = worker.signoff_bundle(job, "{}\n", "create_clock\n", "{}\n", "{}\n", "completed\n")

        self.assertIsNotNone(bundle)
        raw = base64.b64decode(bundle["content"])
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names = set(archive.namelist())
        self.assertIn("layout/top.gds", names)
        self.assertIn("netlists/top.pnl.v", names)
        self.assertIn("timing/top.spef", names)
        self.assertIn("logs/execution.log", names)
        self.assertIn("reports/tapeout-readiness.json", names)
        self.assertIn("configuration/integration-manifest.json", names)
        self.assertIn("CHECKSUMS.sha256", names)

    def test_integration_manifest_hashes_and_classifies_final_views(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary)
            final = job / "final"
            final.mkdir()
            (final / "top.gds").write_bytes(b"layout")
            (final / "top.pnl.v").write_text("module top; endmodule\n", encoding="utf-8")
            (final / "top.cdl").write_text(".subckt top VDD VSS\n.ends\n", encoding="utf-8")
            manifest = worker.integration_manifest(job, {
                "DESIGN_NAME": "top", "PDK": "sky130A", "STD_CELL_LIBRARY": "sky130_fd_sc_hd",
            })

        self.assertEqual(manifest["schema"], "opensemilab.integration-manifest/v1")
        self.assertEqual(len(manifest["files"]), 3)
        self.assertTrue(all(len(item["sha256"]) == 64 for item in manifest["files"]))
        self.assertIn("lvs_netlist", {item["role"] for item in manifest["files"]})

    def test_physical_summary_reports_real_utilization_and_signoff_blockers(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary)
            final = job / "final"
            final.mkdir()
            (final / "design.def").write_text("COMPONENTS 27595 ;\nEND COMPONENTS\n", encoding="utf-8")
            (final / "metrics.csv").write_text(
                "Metric,Value\n"
                "design__core__area,1399930\n"
                "design__instance__area__stdcell,110859\n"
                "design__instance__utilization__stdcell,0.0791887\n"
                "timing__setup__wns,0\n"
                "timing__setup__tns,0\n"
                "timing__setup__ws,1.37323\n"
                "timing__hold__ws,0.15483\n"
                "route__drc_errors,0\n"
                "design__max_slew_violation__count,1072\n"
                "design__max_cap_violation__count,132\n"
                "design__lvs_error__count,0\n"
                "route__antenna_violation__count,0\n"
                "design__power_grid_violation__count,0\n",
                encoding="utf-8",
            )
            summary = worker.physical_summary(job, {
                "PDK": "sky130A", "STD_CELL_LIBRARY": "sky130_fd_sc_hd",
                "DIE_AREA": [0, 0, 1200, 1200], "FP_CORE_UTIL": 35, "CLOCK_PERIOD": 25,
            })

        self.assertAlmostEqual(summary["actual_utilization_pct"], 7.91887)
        self.assertEqual(summary["recommended_die_width_um"], 650)
        self.assertAlmostEqual(summary["estimated_critical_path_ns"], 23.62677)
        self.assertEqual(summary["signoff_status"], "fail")
        self.assertIn("maximum slew: 1072", summary["signoff_blockers"])
        self.assertEqual(summary["tapeout_readiness"]["status"], "fail")
        self.assertFalse(summary["tapeout_readiness"]["production_ready"])
        self.assertIn("rtl_equivalence", {item["id"] for item in summary["tapeout_readiness"]["checks"]})

    def test_relative_floorplan_reads_final_die_dimensions(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary)
            final = job / "final"
            final.mkdir()
            (final / "design.def").write_text(
                "UNITS DISTANCE MICRONS 1000 ;\nDIEAREA ( 0 0 ) ( 650000 600000 ) ;\n"
                "COMPONENTS 1 ;\nEND COMPONENTS\n",
                encoding="utf-8",
            )
            summary = worker.physical_summary(job, {
                "PDK": "sky130A", "STD_CELL_LIBRARY": "sky130_fd_sc_hd",
                "FP_SIZING": "relative", "FP_CORE_UTIL": 35, "CLOCK_PERIOD": 25,
            })

        self.assertEqual(summary["floorplan_mode"], "auto")
        self.assertEqual(summary["die_width_um"], 650)
        self.assertEqual(summary["die_height_um"], 600)
        self.assertEqual(summary["die_area_um2"], 390000)

    def test_physical_summary_ignores_lone_exponent_marker_and_reads_scientific_notation(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary)
            final = job / "final"
            final.mkdir()
            (final / "timing.rpt").write_text(
                "WNS Estimated after placement\nTNS = -1.25E-03\n",
                encoding="utf-8",
            )
            summary = worker.physical_summary(job, {
                "PDK": "sky130A", "STD_CELL_LIBRARY": "sky130_fd_sc_hd",
                "DIE_AREA": [0, 0, 100, 100], "FP_CORE_UTIL": 35,
            })

        self.assertIsNone(summary["wns_ns"])
        self.assertEqual(summary["tns_ns"], -1.25e-3)

    def test_physical_summary_does_not_treat_a_timestamp_year_as_drc_count(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary)
            runs = job / "runs"
            runs.mkdir()
            (runs / "flow.log").write_text(
                "DRC violations checker completed for RUN_2026-09-22\n"
                "* DRC\nPassed ✅\n",
                encoding="utf-8",
            )
            summary = worker.physical_summary(job, {
                "PDK": "sky130A", "STD_CELL_LIBRARY": "sky130_fd_sc_hd",
                "DIE_AREA": [0, 0, 1200, 1200], "FP_CORE_UTIL": 35,
            })

        self.assertEqual(summary["drc_violations"], 0)

    def test_physical_preflight_rejects_insufficient_job_disk(self):
        payload = {
            "action": "physical", "top": "top",
            "sources": {"rtl/top.sv": "module top(input clk); endmodule\n"},
            "physical": {"pdk": "sky130A"},
        }
        with tempfile.TemporaryDirectory() as temporary:
            original_root = worker.WORK_ROOT
            worker.WORK_ROOT = Path(temporary)
            try:
                with patch.object(worker.shutil, "which", return_value="/usr/bin/librelane"), patch.object(worker, "disk_free_mb", return_value=100):
                    with self.assertRaisesRegex(RuntimeError, "PHYSICAL PREFLIGHT ERROR"):
                        worker.execute(payload)
            finally:
                worker.WORK_ROOT = original_root

    def test_streaming_command_stops_before_disk_is_exhausted(self):
        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(worker, "disk_free_mb", return_value=100):
                result = worker.run_streaming_command(
                    ["python3", "-u", "-c", "import time; print('routing'); time.sleep(30)"],
                    Path(temporary), idle_timeout_seconds=60,
                )

        self.assertEqual(result["exit_code"], 75)
        self.assertTrue(result["resource_exhausted"])
        self.assertFalse(result["timed_out"])
        self.assertIn("Stopped before disk exhaustion", result["output"])

    def test_streaming_command_preserves_result_when_process_is_already_reaped(self):
        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(worker.subprocess.Popen, "wait", side_effect=ProcessLookupError(3, "No such process")):
                result = worker.run_streaming_command(
                    ["python3", "-u", "-c", "print('signoff complete')"],
                    Path(temporary), idle_timeout_seconds=60,
                )

        self.assertEqual(result["exit_code"], 0)
        self.assertIn("signoff complete", result["output"])

    def test_physical_stage_detector_reports_furthest_known_stage(self):
        stage = worker.detect_physical_stage("Yosys synthesis complete\nOpenROAD global placement\nClock tree synthesis")
        self.assertEqual(stage["stage"], "cts")
        self.assertEqual(stage["tool"], "OpenROAD")

    def test_physical_log_separates_known_pdk_library_warnings(self):
        diagnostics = worker.classify_physical_log(
            "[WARNING STA-1140] library sky130_fd_io already exists\n"
            "[WARNING] max slew violation in user logic\n"
        )
        self.assertEqual(diagnostics["external_pdk_warning_count"], 1)
        pdk_group = next(item for item in diagnostics["groups"] if item["category"] == "pdk_library")
        self.assertFalse(pdk_group["actionable"])

    def test_background_failure_keeps_live_log_and_diagnostic_artifacts(self):
        job_id = "diagnostic01"
        worker.JOBS[job_id] = {
            "job_id": job_id, "status": "queued", "live_output": "LibreLane reached routing", "elapsed_seconds": 12,
        }
        worker.JOB_CANCEL_EVENTS[job_id] = worker.threading.Event()
        with patch.object(worker, "execute", side_effect=ValueError("could not convert string to float: 'E'")):
            worker.run_background_job(job_id, {"action": "physical"})

        job = worker.JOBS.pop(job_id)
        self.assertEqual(job["status"], "failed")
        self.assertIn("LibreLane reached routing", job["result"]["output"])
        self.assertTrue(any(item["name"] == "execution-diagnostics.txt" for item in job["result"]["artifacts"]))

    def test_vhdl_simulation_runs_three_ghdl_phases_and_collects_vcd(self):
        payload = {"action": "vhdl", "top": "tb_top", "sources": {"rtl/top.vhd": "entity top is end; architecture rtl of top is begin end;"}}
        with tempfile.TemporaryDirectory() as temporary:
            original_root = worker.WORK_ROOT
            worker.WORK_ROOT = Path(temporary)
            commands = []
            def fake_run(command, cwd, timeout_seconds=worker.TIMEOUT_SECONDS, env_overrides=None):
                commands.append(command)
                if "-r" in command:
                    (cwd / "waveform.vcd").write_text("$timescale 1 ns $end\n#0\n", encoding="utf-8")
                return {"exit_code": 0, "output": "ok", "duration_ms": 1, "timed_out": False}
            try:
                with patch.object(worker.shutil, "which", return_value="/usr/bin/ghdl"), patch.object(worker, "run_command", side_effect=fake_run):
                    result = worker.execute(payload)
            finally:
                worker.WORK_ROOT = original_root
        self.assertTrue(result["success"])
        self.assertEqual([next(flag for flag in ("-a", "-e", "-r") if flag in command) for command in commands], ["-a", "-e", "-r"])
        self.assertEqual(result["artifacts"][0]["name"], "waveform.vcd")

    def test_formal_adapter_generates_bounded_bmc_configuration(self):
        payload = {
            "action": "formal",
            "top": "top",
            "adapter": {"depth": 32},
            "sources": {
                "rtl/gpio_peripheral.sv": "module gpio_peripheral; endmodule\n",
                "rtl/top.sv": "module top; gpio_peripheral gpio(); assert property (1); endmodule\n",
            },
        }
        with tempfile.TemporaryDirectory() as temporary:
            original_root = worker.WORK_ROOT
            worker.WORK_ROOT = Path(temporary)
            captured = {}
            def fake_run(command, cwd, timeout_seconds=worker.TIMEOUT_SECONDS, env_overrides=None):
                captured["command"] = command
                captured["config"] = (cwd / "opensemilab.sby").read_text(encoding="utf-8")
                (cwd / "opensemilab" / "status").parent.mkdir()
                (cwd / "opensemilab" / "status").write_text("PASS\n", encoding="utf-8")
                return {"exit_code": 0, "output": "PASS", "duration_ms": 1, "timed_out": False}
            try:
                with patch.object(worker.shutil, "which", return_value="/usr/bin/sby"), patch.object(worker, "run_command", side_effect=fake_run):
                    result = worker.execute(payload)
            finally:
                worker.WORK_ROOT = original_root
        self.assertTrue(result["success"])
        self.assertEqual(result["formal_status"], "pass")
        self.assertEqual(captured["command"][1:], ["-f", "opensemilab.sby"])
        self.assertIn("mode bmc", captured["config"])
        self.assertIn("depth 32", captured["config"])
        self.assertIn("read -formal -sv gpio_peripheral.sv top.sv", captured["config"])
        self.assertIn("[files]\nrtl/gpio_peripheral.sv\nrtl/top.sv", captured["config"])
        self.assertNotIn("read -formal -sv rtl/", captured["config"])

    def test_formal_prove_reports_failed_induction_as_unknown(self):
        payload = {
            "action": "formal",
            "top": "top",
            "adapter": {"depth": 20, "mode": "prove"},
            "sources": {"rtl/top.sv": "module top(input logic clk); always @(posedge clk) assert(1); endmodule\n"},
        }
        with tempfile.TemporaryDirectory() as temporary:
            original_root = worker.WORK_ROOT
            worker.WORK_ROOT = Path(temporary)
            try:
                with patch.object(worker.shutil, "which", return_value="/usr/bin/sby"), patch.object(
                    worker,
                    "run_command",
                    return_value={
                        "exit_code": 4,
                        "output": "basecase: Status returned by engine for basecase: pass\nTemporal induction failed!\nDONE (UNKNOWN, rc=4)",
                        "duration_ms": 1,
                        "timed_out": False,
                    },
                ):
                    result = worker.execute(payload)
            finally:
                worker.WORK_ROOT = original_root
        self.assertFalse(result["success"])
        self.assertEqual(result["formal_status"], "unknown")
        self.assertEqual(result["formal_mode"], "prove")
        self.assertEqual(result["engine"], "SymbiYosys (PROVE)")

    def test_formal_adapter_rejects_duplicate_source_basenames(self):
        payload = {
            "action": "formal",
            "top": "top",
            "sources": {
                "rtl/shared.sv": "module shared; endmodule\n",
                "verification/shared.sv": "module shared_test; endmodule\n",
            },
        }
        with tempfile.TemporaryDirectory() as temporary:
            original_root = worker.WORK_ROOT
            worker.WORK_ROOT = Path(temporary)
            try:
                with patch.object(worker.shutil, "which", return_value="/usr/bin/sby"):
                    with self.assertRaisesRegex(ValueError, "unique source basenames"):
                        worker.execute(payload)
            finally:
                worker.WORK_ROOT = original_root

    def test_fpga_adapter_runs_yosys_then_nextpnr_and_collects_asc(self):
        payload = {"action": "fpga", "top": "top", "adapter": {"device": "up5k", "package": "sg48", "frequency_mhz": 24}, "sources": {"rtl/top.sv": "module top(output logic led); assign led=1; endmodule\n", "constraints/pins.pcf": "set_io led 39\n"}}
        with tempfile.TemporaryDirectory() as temporary:
            original_root = worker.WORK_ROOT
            worker.WORK_ROOT = Path(temporary)
            commands = []
            def fake_run(command, cwd, timeout_seconds=worker.TIMEOUT_SECONDS, env_overrides=None):
                commands.append(command)
                if command[0] == worker.TOOL_BINARIES["yosys"]:
                    (cwd / "netlist.json").write_text("{}", encoding="utf-8")
                else:
                    (cwd / "design.asc").write_text(".comment OpenSemiLab\n", encoding="utf-8")
                return {"exit_code": 0, "output": "ok", "duration_ms": 1, "timed_out": False}
            try:
                with patch.object(worker.shutil, "which", return_value="/usr/bin/tool"), patch.object(worker, "run_command", side_effect=fake_run):
                    result = worker.execute(payload)
            finally:
                worker.WORK_ROOT = original_root
        self.assertTrue(result["success"])
        self.assertEqual(len(commands), 2)
        self.assertIn("--up5k", commands[1])
        self.assertIn("constraints/pins.pcf", commands[1])
        self.assertTrue(any(artifact["name"] == "design.asc" for artifact in result["artifacts"]))

    def test_fpga_adapter_explains_top_level_io_overflow_before_place_and_route(self):
        payload = {"action": "fpga", "top": "raw_core", "adapter": {"device": "up5k", "package": "sg48"}, "sources": {"rtl/core.sv": "module raw_core(input logic [63:0] pins); endmodule\n"}}
        with tempfile.TemporaryDirectory() as temporary:
            original_root = worker.WORK_ROOT
            worker.WORK_ROOT = Path(temporary)
            commands = []
            def fake_run(command, cwd, timeout_seconds=worker.TIMEOUT_SECONDS, env_overrides=None):
                commands.append(command)
                (cwd / "netlist.json").write_text('{"modules":{"raw_core":{"ports":{"pins":{"bits":[' + ','.join(str(index) for index in range(64)) + ']}}}}}', encoding="utf-8")
                return {"exit_code": 0, "output": "synthesis ok", "duration_ms": 1, "timed_out": False}
            try:
                with patch.object(worker.shutil, "which", return_value="/usr/bin/tool"), patch.object(worker, "run_command", side_effect=fake_run):
                    result = worker.execute(payload)
            finally:
                worker.WORK_ROOT = original_root
        self.assertFalse(result["success"])
        self.assertEqual(result["fpga_status"], "io_overflow")
        self.assertEqual(result["io_bits"], 64)
        self.assertIn("board wrapper", result["output"])
        self.assertEqual(len(commands), 1)

    def test_specialized_adapters_use_named_bounded_commands(self):
        cases = [
            ("xyce", {"entry": "tb.cir", "sources": {"tb.cir": "V1 1 0 1\n.end\n"}}, "Xyce"),
            ("openems", {"entry": "model.xml", "sources": {"model.xml": "<openEMS/>"}}, "openEMS"),
            ("xschem", {"entry": "design.sch", "sources": {"design.sch": "v {xschem version=3.4.0}"}}, "Xschem"),
            ("cace", {"entry": "datasheet.yaml", "sources": {"datasheet.yaml": "name: demo\n"}}, "CACE"),
            ("gds3d", {"entry": "layout.gds", "encodings": {"layout.gds": "base64"}, "sources": {"layout.gds": b64encode(b"GDSII").decode()}}, "GDS3D"),
        ]
        for action, fields, engine in cases:
            with self.subTest(action=action), tempfile.TemporaryDirectory() as temporary:
                original_root = worker.WORK_ROOT
                worker.WORK_ROOT = Path(temporary)
                command_seen = []
                def fake_run(command, cwd, timeout_seconds=worker.TIMEOUT_SECONDS, env_overrides=None):
                    command_seen.append(command)
                    if action == "xyce":
                        (cwd / "xyce.log").write_text("Xyce ok", encoding="utf-8")
                        (cwd / "tb.prn").write_text("TIME V(out) INDEX\n0 0 0\n1e-9 1.2 1\n", encoding="utf-8")
                    if action == "xschem": (cwd / "netlist" / "generated.spice").write_text(".end\n", encoding="utf-8")
                    return {"exit_code": 124 if action == "gds3d" else 0, "output": "viewer active" if action == "gds3d" else "ok", "duration_ms": 1, "timed_out": action == "gds3d"}
                try:
                    with patch.object(worker.shutil, "which", side_effect=lambda binary: None if binary == "xvfb-run" else f"/usr/bin/{binary}"), patch.object(worker, "run_command", side_effect=fake_run):
                        result = worker.execute({"action": action, "top": "top", **fields})
                finally:
                    worker.WORK_ROOT = original_root
                self.assertTrue(result["success"])
                self.assertEqual(result["engine"], engine)
                self.assertTrue(command_seen)
                if action == "xyce":
                    self.assertEqual(result["simulation"]["plots"][0]["series"][0]["y"], [0.0, 1.2])


if __name__ == "__main__":
    unittest.main()
