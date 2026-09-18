import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


WORKER_PATH = Path(__file__).resolve().parents[1] / "worker.py"
SPEC = importlib.util.spec_from_file_location("opensemilab_worker", WORKER_PATH)
worker = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(worker)


class WorkerResultTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
