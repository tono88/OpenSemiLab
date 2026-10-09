"""S-parametros de red LC ideal mediante ABCD; sin paquetes ni solver EM.

La red se define tambien en schematic/matching.spice. Cambie ambos al modificar
la topologia. Reciprocidad y conservacion de potencia detectan errores de calculo.
"""
import argparse
import cmath
import csv
import math
from pathlib import Path


def sparameters(frequency, inductance=3.3e-9, capacitance=1.3e-12, z0=50):
    # ABCD: serie Z_L seguida por admitancia C en paralelo.
    omega = 2 * math.pi * frequency
    z = 1j * omega * inductance
    y = 1j * omega * capacitance
    a, b, c, d = 1 + z * y, z, y, 1
    denominator = a + b / z0 + c * z0 + d
    s11 = (a + b / z0 - c * z0 - d) / denominator
    s21 = 2 / denominator
    s12 = 2 * (a * d - b * c) / denominator
    s22 = (-a + b / z0 - c * z0 + d) / denominator
    return s11, s21, s12, s22


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--l-nh", type=float, default=3.3)
    parser.add_argument("--c-pf", type=float, default=1.3)
    parser.add_argument("--points", type=int, default=81)
    options = parser.parse_args()
    assert 3 <= options.points <= 10000, "points debe estar entre 3 y 10000"
    assert options.l_nh > 0 and options.c_pf > 0, "L/C deben ser positivos"
    root = Path(__file__).resolve().parents[1]
    build = root / "build"
    build.mkdir(exist_ok=True)
    rows = []
    touchstone = ["! LC ideal, analytical ABCD, not EM/foundry data", "# Hz S RI R 50"]
    for index in range(options.points):
        frequency = 1e8 * (100 ** (index / (options.points - 1)))
        values = sparameters(frequency, options.l_nh * 1e-9, options.c_pf * 1e-12)
        s11, s21, s12, s22 = values
        assert abs(s21 - s12) < 1e-10, "Falla reciprocidad"
        assert abs(abs(s11)**2 + abs(s21)**2 - 1) < 1e-10, "Falla conservacion de potencia puerto 1"
        assert abs(abs(s22)**2 + abs(s12)**2 - 1) < 1e-10, "Falla conservacion de potencia puerto 2"
        rows.append([frequency, 20 * math.log10(max(abs(s11), 1e-15)), 20 * math.log10(abs(s21)), math.degrees(cmath.phase(s21))])
        # Touchstone 2-port order: S11, S21, S12, S22, real/imaginary.
        touchstone.append(" ".join([f"{frequency:.12g}"] + [f"{component:.12g}" for value in values for component in (value.real, value.imag)]))
    with (build / "sparameters.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["frequency_hz", "s11_db", "s21_db", "s21_phase_deg"])
        writer.writerows(rows)
    (build / "matching.s2p").write_text("\n".join(touchstone) + "\n")
    print(f"PASS RF reciprocity and lossless power over {options.points} frequencies")
    print("Outputs: build/sparameters.csv and build/matching.s2p")


if __name__ == "__main__":
    main()
