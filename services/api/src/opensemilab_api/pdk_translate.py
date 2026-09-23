from __future__ import annotations

import gzip
import hashlib
import json
import re
from html import escape
from pathlib import Path


IR_SCHEMA = "opensemilab.pdk-rule-ir/v1"
MAX_TEXT_BYTES = 32 * 1024 * 1024
STACK_PATTERN = re.compile(r"(?i)(\d+p\d+m(?:_\d+tm)?(?:_\d+k)?)")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _selected(path: Path, stack: str | None) -> bool:
    if not stack:
        return True
    match = STACK_PATTERN.search(str(path))
    return not match or match.group(1).upper() == stack.upper()


def _text(path: Path) -> str | None:
    try:
        if path.stat().st_size > MAX_TEXT_BYTES:
            return None
        with path.open("rb") as source:
            magic = source.read(2)
        if magic == b"\x1f\x8b":
            with gzip.open(path, "rb") as source:
                data = source.read(MAX_TEXT_BYTES + 1)
        else:
            data = path.read_bytes()
    except OSError:
        return None
    if len(data) > MAX_TEXT_BYTES:
        return None
    data = data[:MAX_TEXT_BYTES]
    if b"\0" in data[:4096]:
        return None
    return data.decode("utf-8", errors="ignore")


def _number(value: str) -> float | str:
    try:
        return float(value)
    except ValueError:
        return value


def _tlu_header(path: Path) -> str | None:
    try:
        with path.open("rb") as source:
            magic = source.read(2)
        if magic == b"\x1f\x8b":
            with gzip.open(path, "rb") as source:
                data = source.read(MAX_TEXT_BYTES + 1)
        else:
            with path.open("rb") as source:
                data = source.read(MAX_TEXT_BYTES + 1)
    except (OSError, EOFError):
        return None
    if len(data) > MAX_TEXT_BYTES:
        return None
    marker = re.search(br"(?i)####\s*end_ascii_header", data)
    if marker:
        data = data[:marker.start()]
    else:
        data = data.split(b"\0", 1)[0]
    return data.decode("utf-8", errors="ignore")


def _layer_maps(paths: list[Path]) -> tuple[dict[tuple[int, int], dict], int]:
    layers: dict[tuple[int, int], dict] = {}
    id_to_pair: dict[int, tuple[int, int]] = {}
    names: dict[int, str] = {}
    statements = 0
    for path in paths:
        text = _text(path)
        if not text:
            continue
        for match in re.finditer(r"(?im)^\s*[DT]\s+(\d+):(\d+)\s+(\d+)\s+(\d+)(?:\s*;\s*(.*))?$", text):
            source_layer, source_datatype, gds_layer, gds_datatype, label = match.groups()
            pair = (int(gds_layer), int(gds_datatype))
            record = layers.setdefault(pair, {"gds_layer": pair[0], "datatype": pair[1]})
            record.update({
                "purpose": "text" if match.group(0).lstrip().upper().startswith("T") else "drawing",
            })
            if label:
                record.setdefault("name", label.strip().split()[0])
            statements += 1
        for match in re.finditer(r"(?im)^\s*LAYER\s+MAP\s+(\d+)\s+DATATYPE\s+(\d+)\s+(\d+)\b", text):
            gds_layer, datatype, internal = map(int, match.groups())
            pair = (gds_layer, datatype)
            id_to_pair[internal] = pair
            layers.setdefault(pair, {"gds_layer": gds_layer, "datatype": datatype, "purpose": "drawing"})
            statements += 1
        for match in re.finditer(r"(?im)^\s*layer_map\s+(\d+)\s+-datatype\s+(\d+)\s+(\d+)\s*;", text):
            gds_layer, datatype, internal = map(int, match.groups())
            pair = (gds_layer, datatype)
            id_to_pair[internal] = pair
            layers.setdefault(pair, {"gds_layer": gds_layer, "datatype": datatype, "purpose": "drawing"})
            statements += 1
        for pattern in (
            r"(?im)^\s*LAYER\s+([A-Za-z_][\w.$-]*)\s+(\d+)\s*$",
            r"(?im)^\s*layer_def\s+([A-Za-z_][\w.$-]*)\s+(\d+)\s*;",
        ):
            for match in re.finditer(pattern, text):
                name, internal = match.groups()
                names[int(internal)] = name
                statements += 1
    for internal, pair in id_to_pair.items():
        record = layers[pair]
        record.setdefault("internal_ids", []).append(internal)
        if internal in names:
            record["name"] = names[internal]
    for pair, record in layers.items():
        record.setdefault("name", f"LAYER_{pair[0]}_{pair[1]}")
    return layers, statements


def _lvs(paths: list[Path], layers: dict[tuple[int, int], dict]) -> dict:
    name_by_id = {
        str(internal): value["name"]
        for value in layers.values()
        for internal in value.get("internal_ids", [])
    }
    connections: set[tuple[str, str]] = set()
    devices: set[str] = set()
    parsed = 0
    unsupported = 0
    for path in paths:
        text = _text(path)
        if not text:
            continue
        for match in re.finditer(r"(?im)^\s*S?CONNECT\s+([\w.$-]+)\s+([\w.$-]+)", text):
            left, right = match.groups()
            connections.add((name_by_id.get(left, left), name_by_id.get(right, right)))
            parsed += 1
        for match in re.finditer(r"(?im)^\s*(?:connect|sconnect)\s*\(?\s*([\w.$-]+)\s*[, ]\s*([\w.$-]+)", text):
            left, right = match.groups()
            connections.add((name_by_id.get(left, left), name_by_id.get(right, right)))
            parsed += 1
        for match in re.finditer(r"(?im)^\s*(?:DEVICE|device)\s+([A-Za-z_][\w.$-]*)", text):
            devices.add(match.group(1))
            parsed += 1
        unsupported += len(re.findall(r"(?im)^\s*(?:BOOLEAN|DFM|ERC|LVS\s+REPORT|PROPERTY|CONNECT\s+BY)\b", text))
    return {
        "connections": [{"from": left, "to": right} for left, right in sorted(connections)],
        "device_families": sorted(devices),
        "parsed_statements": parsed,
        "unsupported_statements": unsupported,
    }


def _tluplus(paths: list[Path]) -> tuple[list[dict], int]:
    corners: list[dict] = []
    parsed = 0
    for path in paths:
        text = _tlu_header(path)
        if not text:
            continue
        header = text
        materials: list[dict] = []
        for kind, name, body in re.findall(
            r"(?is)\b(DIELECTRIC|CONDUCTOR|VIA)\s+([A-Za-z_][\w.$-]*)\s*\{(.*?)\}", header
        ):
            properties = {
                key.upper(): _number(value)
                for key, value in re.findall(r"(?i)\b([A-Z][A-Z0-9_]*)\s*=\s*([-+\w.eE]+)", body)
            }
            materials.append({"kind": kind.lower(), "name": name, "properties": properties})
            parsed += 1
        if materials:
            lower = path.name.lower()
            corner = "best" if any(token in lower for token in ("best", "bst")) else (
                "worst" if any(token in lower for token in ("worst", "wst")) else "typical"
            )
            corners.append({"corner": corner, "materials": materials, "source_sha256": _sha256(path)})
    unique: dict[str, dict] = {}
    for corner in corners:
        unique.setdefault(corner["corner"], corner)
    return [unique[key] for key in ("best", "typical", "worst") if key in unique], parsed


def _safe_var(name: str, used: set[str]) -> str:
    base = re.sub(r"\W+", "_", name).strip("_").lower() or "layer"
    if base[0].isdigit():
        base = f"layer_{base}"
    result = base
    index = 2
    while result in used:
        result = f"{base}_{index}"
        index += 1
    used.add(result)
    return result


def _write_klayout(output: Path, layers: dict[tuple[int, int], dict], lvs: dict) -> list[str]:
    if not layers:
        return []
    klayout = output / "klayout"
    klayout.mkdir(parents=True, exist_ok=True)
    colors = ("#4fc3f7", "#81c784", "#ffb74d", "#ba68c8", "#e57373", "#fff176")
    properties = ["<?xml version=\"1.0\" encoding=\"utf-8\"?>", "<layer-properties>"]
    for index, record in enumerate(sorted(layers.values(), key=lambda item: (item["gds_layer"], item["datatype"]))):
        properties.extend((
            "  <properties>", f"    <name>{escape(record['name'])}</name>",
            f"    <source>{record['gds_layer']}/{record['datatype']}@1</source>",
            f"    <fill-color>{colors[index % len(colors)]}</fill-color>",
            f"    <frame-color>{colors[index % len(colors)]}</frame-color>",
            "    <visible>true</visible>", "  </properties>",
        ))
    properties.append("</layer-properties>")
    (klayout / "layers.lyp").write_text("\n".join(properties) + "\n", encoding="utf-8")
    (klayout / "technology.lyt").write_text(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
        "<technology><name>OpenSemiLab translated draft</name>"
        "<description>Generated from authorized vendor maps; validate before fabrication.</description>"
        "<reader-options><common><layer-map></layer-map></common></reader-options>"
        "<layer-properties_file>layers.lyp</layer-properties_file></technology>\n",
        encoding="utf-8",
    )
    variables: dict[str, str] = {}
    used: set[str] = set()
    script = [
        "# OpenSemiLab generated KLayout LVS draft.",
        "# NOT FOR SIGN-OFF: validate connectivity and device extraction against foundry references.",
        "report(\"OpenSemiLab translated LVS draft\")",
    ]
    for record in sorted(layers.values(), key=lambda item: item["name"]):
        variable = _safe_var(record["name"], used)
        variables.setdefault(record["name"], variable)
        script.append(f"{variable} = input({record['gds_layer']}, {record['datatype']}) # {record['name']}")
    for connection in lvs["connections"]:
        left = variables.get(connection["from"])
        right = variables.get(connection["to"])
        if left and right:
            script.append(f"connect({left}, {right})")
    script.extend((
        "# Device extraction is intentionally not synthesized from vendor syntax.",
        "# Add validated extract_devices/connect_global_net/netlist rules, then run compare.",
    ))
    (klayout / "lvs_draft.lylvs").write_text("\n".join(script) + "\n", encoding="utf-8")
    return ["klayout/technology.lyt", "klayout/layers.lyp", "klayout/lvs_draft.lylvs"]


def _write_openrcx(output: Path, corners: list[dict]) -> list[str]:
    if not corners:
        return []
    rcx = output / "openrcx"
    rcx.mkdir(parents=True, exist_ok=True)
    for corner in corners:
        (rcx / f"materials-{corner['corner']}.json").write_text(
            json.dumps({"schema": IR_SCHEMA, **corner, "status": "bootstrap_only"}, indent=2) + "\n",
            encoding="utf-8",
        )
    (rcx / "CALIBRATION_REQUIRED.md").write_text(
        "# OpenRCX calibration required\n\n"
        "The material parameters were recovered from readable TLUPlus headers. Binary capacitance "
        "tables and encrypted xRC rules were not converted. Generate process patterns with the official "
        "OpenRCX calibration flow, obtain trusted reference parasitics, and calibrate `rcx_patterns.rules` "
        "for every corner before using extraction results.\n",
        encoding="utf-8",
    )
    return [f"openrcx/materials-{item['corner']}.json" for item in corners] + ["openrcx/CALIBRATION_REQUIRED.md"]


def _write_export_guides(output: Path) -> list[str]:
    guide = output / "commercial-export"
    guide.mkdir(parents=True, exist_ok=True)
    (guide / "M31_GDS_EXPORT_REQUIRED.md").write_text(
        "# M31 GDS export required\n\n"
        "The uploaded M31 package contains Milkyway CEL/FRAM databases, not a GDS/OASIS stream. "
        "OpenSemiLab does not reverse-engineer that proprietary database. In an authorized licensed "
        "Synopsys installation, open the exact Milkyway library/cell, load the selected foundry stream-out "
        "map, export GDSII or OASIS, and verify cell count, top cell, units, layers and reference resolution. "
        "Upload that exported `.gds`/`.oas` in **Añadir vistas faltantes**.\n",
        encoding="utf-8",
    )
    (guide / "M31_CDL_REQUIRED.md").write_text(
        "# M31 CDL/SPI source required\n\n"
        "No transistor-level CDL/SPI view was found in the supplied M31 packages. Verilog and Liberty "
        "cannot be converted into an LVS-equivalent transistor netlist. Request the authorized standard-cell "
        "CDL/SPICE view from M31 or export it from the licensed schematic source, then upload `.cdl` or `.spi`.\n",
        encoding="utf-8",
    )
    return ["commercial-export/M31_GDS_EXPORT_REQUIRED.md", "commercial-export/M31_CDL_REQUIRED.md"]


def translate_commercial_references(content: Path, output: Path, selected_stack: str | None) -> dict:
    candidates = [path for path in content.rglob("*") if path.is_file() and "generated-adapter" not in path.parts and _selected(path, selected_stack)]
    map_paths = [path for path in candidates if path.suffix.lower() == ".map" or path.suffix.lower() in {".cal", ".pvs"}]
    lvs_paths = [path for path in candidates if path.suffix.lower() in {".cal", ".pvs"} or "lvs" in str(path).lower()]
    tlu_paths = [path for path in candidates if "tluplus" in path.name.lower()]
    encrypted = []
    for path in candidates:
        if path.suffix.lower() in {".r", ".c"} or ".rules." in path.name.lower():
            sample = path.read_bytes()[:4096]
            if b"#DECRYPT" in sample or b"ENCRYPT" in sample.upper():
                encrypted.append({"kind": "xrc_rule", "sha256": _sha256(path)})
    layers, layer_statements = _layer_maps(map_paths)
    lvs = _lvs(lvs_paths, layers)
    corners, rc_statements = _tluplus(tlu_paths)
    generated = _write_klayout(output, layers, lvs)
    generated.extend(_write_openrcx(output, corners))
    if any("milkyway" in str(path).lower() for path in candidates):
        generated.extend(_write_export_guides(output))
    ir = {
        "schema": IR_SCHEMA,
        "selected_stack": selected_stack,
        "status": "draft_requires_validation",
        "layers": list(sorted(layers.values(), key=lambda item: (item["gds_layer"], item["datatype"]))),
        "lvs": lvs,
        "rc_corners": corners,
        "encrypted_sources": encrypted,
        "coverage": {
            "layer_statements": layer_statements,
            "lvs_statements": lvs["parsed_statements"],
            "rc_material_statements": rc_statements,
            "encrypted_files": len(encrypted),
        },
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "rule-ir.json").write_text(json.dumps(ir, indent=2) + "\n", encoding="utf-8")
    report = {
        "schema": IR_SCHEMA,
        "status": "draft_requires_validation",
        "selected_stack": selected_stack,
        "artifacts_generated": generated + ["rule-ir.json", "translation-report.json"],
        "coverage": ir["coverage"],
        "layer_count": len(layers),
        "lvs_connection_count": len(lvs["connections"]),
        "lvs_device_family_count": len(lvs["device_families"]),
        "rc_corner_count": len(corners),
        "requires_validation": ["klayout_stream", "lvs_devices_and_connectivity", "openrcx_calibration", "foundry_signoff"],
        "limitations": [
            "Encrypted xRC rule bodies are not translated.",
            "TLUPlus binary capacitance tables are not decoded.",
            "Generated KLayout and LVS files are drafts, not foundry sign-off decks.",
            "M31 GDS and transistor-level CDL/SPI must be exported or supplied by their authorized source.",
        ],
    }
    (output / "translation-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return {
        "status": report["status"],
        "layer_count": report["layer_count"],
        "lvs_connection_count": report["lvs_connection_count"],
        "lvs_device_family_count": report["lvs_device_family_count"],
        "rc_corner_count": report["rc_corner_count"],
        "encrypted_file_count": len(encrypted),
        "artifact_count": len(report["artifacts_generated"]),
        "requires_validation": True,
    }
