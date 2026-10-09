"""Valida medidas ngspice. Una medida ausente, NaN o fuera de rango es un fallo."""
import json
import math
from pathlib import Path
import re
import sys


def check(log_path):
    root = Path(__file__).resolve().parents[1]
    criteria = json.loads((root / "verification" / "spice_checks.json").read_text())
    log = Path(log_path).read_text(errors="replace")
    for name, bounds in criteria.items():
        matches = re.findall(r"^\s*" + re.escape(name) + r"\s*=\s*(\S+)", log, re.MULTILINE | re.IGNORECASE)
        assert matches, f"Medida ausente: {name}; revise build/spice.log"
        value = float(matches[-1])
        assert math.isfinite(value), f"Medida no finita: {name}"
        assert bounds[0] <= value <= bounds[1], f"{name}={value:g}, esperado {bounds}"
        print(f"PASS {name}={value:g} dentro de {bounds}")


if __name__ == "__main__":
    check(sys.argv[1] if len(sys.argv) > 1 else "build/spice.log")
