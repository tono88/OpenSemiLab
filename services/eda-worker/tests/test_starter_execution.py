"""Generate the real browser starters; verify standalone recipes and real tools.

Lightweight tests always run. Tool-dependent tests require installed binaries;
CI sets OPENSEMILAB_REQUIRE_EDA_TOOLS=1 so missing tools cannot silently skip.
"""
import csv
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
FIXTURE_SCRIPT = ROOT / "apps/web/scripts/template-fixtures.mjs"
TOOLS = ("iverilog", "vvp", "yosys", "ngspice", "ghdl")


class StarterExecutionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which("node"):
            raise unittest.SkipTest("Node 22.13+ required to generate browser starters")
        result = subprocess.run(["node", str(FIXTURE_SCRIPT)], capture_output=True, text=True, check=True, timeout=30)
        cls.projects = json.loads(result.stdout)
        if os.environ.get("OPENSEMILAB_REQUIRE_EDA_TOOLS") == "1":
            missing = [tool for tool in TOOLS if not shutil.which(tool)]
            assert not missing, f"Required EDA tools missing: {missing}"

    def materialize(self, name, root):
        for file in self.projects[name]:
            path = root / file["path"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(file["content"], encoding="utf-8")

    def run_recipe(self, name, target):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.materialize(name, root)
            result = subprocess.run(["make", target], cwd=root, capture_output=True, text=True, timeout=90)
            # Include the simulator's diagnostic file, not only make's wrapper.
            # Temporary project directories disappear when the test finishes.
            log_path = root / "build/spice.log"
            diagnostics = log_path.read_text(errors="replace") if result.returncode and log_path.exists() else ""
            self.assertEqual(result.returncode, 0, f"{name} / make {target}:\n{result.stdout}\n{result.stderr}\n{diagnostics[:16000]}")
            self.assertIn("PASS", result.stdout + result.stderr)
            return result.stdout

    def test_all_downloaded_projects_validate_their_manifest(self):
        for name in self.projects:
            with self.subTest(project=name):
                self.run_recipe(name, "check")

    def test_rf_network_has_reciprocity_passivity_and_touchstone_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.materialize("rf_frontend", root)
            result = subprocess.run(["python3", "scripts/rf_network.py"], cwd=root, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            with (root / "build/sparameters.csv").open() as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 81)
            self.assertAlmostEqual(float(rows[0]["frequency_hz"]), 1e8)
            self.assertAlmostEqual(float(rows[-1]["frequency_hz"]), 1e10)
            self.assertTrue(all(float(row["s21_db"]) <= 1e-10 for row in rows))
            touchstone = (root / "build/matching.s2p").read_text()
            self.assertIn("# Hz S RI R 50", touchstone)
            self.assertEqual(len(touchstone.splitlines()), 83)

    def test_spice_checker_rejects_missing_nonfinite_and_out_of_range_metrics(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.materialize("sensor_interface", root)
            criteria = json.loads((root / "verification/spice_checks.json").read_text())
            log = root / "test.log"
            baseline = {name: (bounds[0] + bounds[1]) / 2 for name, bounds in criteria.items()}
            cases = [baseline, {**baseline, "gain_low": 99}, {**baseline, "gain_low": "nan"}, {k: v for k, v in baseline.items() if k != "gain_low"}]
            for index, metrics in enumerate(cases):
                log.write_text("\n".join(f"{name} = {value}" for name, value in metrics.items()))
                result = subprocess.run(["python3", "scripts/check_spice.py", str(log)], cwd=root, capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode == 0, index == 0, result.stderr)

    def test_generic_cmos_contains_devices_not_a_placeholder(self):
        cell = {file["path"]: file["content"] for file in self.projects["standard_cell"]}
        self.assertRegex(cell["schematic/inverter.spice"], r"(?m)^MP ")
        self.assertRegex(cell["schematic/inverter.spice"], r"(?m)^MN ")
        self.assertIn(".model NMOS_DEMO", cell["models/generic_cmos.lib"])

    @unittest.skipUnless(shutil.which("iverilog") and shutil.which("vvp"), "Icarus Verilog required")
    def test_real_systemverilog_regressions(self):
        for name in ("microcontroller", "sensor_interface", "standard_cell", "fpga_prototype"):
            with self.subTest(project=name):
                output = self.run_recipe(name, "sim")
                self.assertIn("PASS", output)

    @unittest.skipUnless(shutil.which("yosys"), "Yosys required")
    def test_real_yosys_synthesis_and_formal_assertions(self):
        for name in ("microcontroller", "sensor_interface", "standard_cell", "fpga_prototype"):
            with self.subTest(project=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.materialize(name, root)
                result = subprocess.run(["make", "synth"], cwd=root, capture_output=True, text=True, timeout=45)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertTrue((root / "build/netlist.json").exists())
        for name, top in (("microcontroller", "watchdog_properties"), ("standard_cell", "inverter_properties")):
            with self.subTest(formal=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.materialize(name, root)
                sources = [file["path"] for file in self.projects[name] if file["path"].endswith('.sv') and (file["role"] == "source" or file["path"].startswith("verification/formal/"))]
                depth = 24 if name == "microcontroller" else 2
                # Prove assertions with the built-in SAT backend as well as
                # checking the harness. This needs no external SMT solver.
                script = f"read_verilog -formal -sv {' '.join(sources)}; prep -top {top}; async2sync; dffunmap; check -assert; flatten; opt_clean; sat -seq {depth} -prove-asserts -set-assumes -verify"
                result = subprocess.run(["yosys", "-p", script], cwd=root, capture_output=True, text=True, timeout=45)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    @unittest.skipUnless(shutil.which("ngspice"), "ngspice required")
    def test_real_spice_measurements_meet_acceptance_ranges(self):
        for name in ("sensor_interface", "analog_block", "rf_frontend", "standard_cell"):
            with self.subTest(project=name):
                self.run_recipe(name, "spice")

    @unittest.skipUnless(shutil.which("ghdl"), "GHDL required")
    def test_real_vhdl_regressions_finish_and_assert_correct_behavior(self):
        for name in ("microcontroller_vhdl", "fpga_prototype_vhdl"):
            with self.subTest(project=name):
                self.run_recipe(name, "sim")


if __name__ == "__main__":
    unittest.main()
