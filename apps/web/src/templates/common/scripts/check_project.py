"""Comprueba las entradas del proyecto descargado; no necesita paquetes externos."""
import json
from pathlib import Path, PurePosixPath


def check():
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "project.json").read_text(encoding="utf-8"))
    assert manifest["schema"] == "opensemilab.project/v3", "Schema incompatible"
    assert manifest["name"].strip(), "Falta nombre del proyecto"
    for key in ("rtl_top", "testbench_top", "fpga_top"):
        top = manifest.get("execution", {}).get(key)
        if top:
            assert top.replace("_", "").isalnum(), f"Top invalido: {top}"
            hdl = [*root.rglob("*.sv"), *root.rglob("*.vhd")]
            assert any(f"module {top}" in p.read_text() or f"entity {top} " in p.read_text() for p in hdl), f"No existe el top {top}"
    entry = manifest.get("execution", {}).get("spice_entry")
    if entry:
        path = PurePosixPath(entry)
        assert not path.is_absolute() and ".." not in path.parts, "Ruta SPICE insegura"
        assert (root / entry).is_file(), f"Falta entrada SPICE: {entry}"
    assert (root / "docs" / "ACCEPTANCE.md").is_file(), "Falta checklist de entrega"
    print("PASS project manifest and entry files")


if __name__ == "__main__":
    check()
