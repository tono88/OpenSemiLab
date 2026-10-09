"""Barrido de A0/FP del MODELO, no corners de proceso ni Monte Carlo de silicio."""
from pathlib import Path
import subprocess
import sys

from check_spice import check


def sweep():
    root = Path(__file__).resolve().parents[1]
    build = root / "build"
    build.mkdir(exist_ok=True)
    source = (root / "simulation" / "testbench.spice").read_text()
    corners = (("low", 5000, 100), ("nominal", 10000, 100), ("high", 15000, 100))
    for name, gain, pole in corners:
        deck = build / f"macro_{name}.cir"
        deck.write_text(source.replace(".param A0=10000 FP=100", f".param A0={gain} FP={pole}"))
        log = build / f"macro_{name}.log"
        subprocess.run(["ngspice", "-b", "-o", str(log), str(deck)], cwd=root, check=True, timeout=30)
        if name == "nominal":
            check(log)
        # Other corners are exploratory: report their measured values without
        # incorrectly asserting that nominal bandwidth holds for every A0.
        print(name, "A0=", gain, "FP=", pole, "approx GBW=", gain * pole, "Hz")
        print("Review", log)


if __name__ == "__main__":
    sweep()
