from __future__ import annotations

import json
import hashlib
import os
import re
import shutil
import tarfile
import tempfile
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import BinaryIO

from fastapi import UploadFile

from .pdk_translate import translate_commercial_references


PROFILE_SCHEMA = "opensemilab.pdk-profile/v1"
REGISTRY_SCHEMA = "opensemilab.private-pdk/v1"
COMPILATION_SCHEMA = "opensemilab.pdk-compilation/v1"
SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{2,63}$")
MAX_FILES = int(os.getenv("OPENSEMILAB_PDK_MAX_FILES", "50000"))
MAX_UPLOAD_BYTES = int(os.getenv("OPENSEMILAB_PDK_MAX_UPLOAD_BYTES", str(2 * 1024**3)))
MAX_EXPANDED_BYTES = int(os.getenv("OPENSEMILAB_PDK_MAX_EXPANDED_BYTES", str(8 * 1024**3)))


def registry_root() -> Path:
    return Path(os.getenv("OPENSEMILAB_PDK_ROOT", "/var/lib/opensemilab-pdks"))


def _safe_relative(name: str) -> Path:
    normalized = name.replace("\\", "/")
    path = PurePosixPath(normalized)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError("Archive contains an unsafe path")
    return Path(*path.parts)


def _copy_stream(source: BinaryIO, destination: Path, byte_limit: int, counter: list[int]) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as output:
        while chunk := source.read(1024 * 1024):
            counter[0] += len(chunk)
            if counter[0] > byte_limit:
                raise ValueError("PDK package exceeds the configured size limit")
            output.write(chunk)


def _extract_zip(archive: Path, destination: Path, expanded: list[int], files: list[int]) -> None:
    with zipfile.ZipFile(archive) as bundle:
        for item in bundle.infolist():
            target = destination / _safe_relative(item.filename)
            mode = (item.external_attr >> 16) & 0o170000
            if mode == 0o120000:
                raise ValueError("Symbolic links are not allowed in PDK archives")
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            files[0] += 1
            expanded[0] += item.file_size
            if files[0] > MAX_FILES or expanded[0] > MAX_EXPANDED_BYTES:
                raise ValueError("Expanded PDK exceeds the configured safety limits")
            with bundle.open(item) as source:
                _copy_stream(source, target, MAX_EXPANDED_BYTES, [expanded[0] - item.file_size])


def _extract_tar(archive: Path, destination: Path, expanded: list[int], files: list[int]) -> None:
    with tarfile.open(archive, "r:*") as bundle:
        for item in bundle:
            target = destination / _safe_relative(item.name)
            if item.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if not item.isfile():
                raise ValueError("Links, devices, and special files are not allowed in PDK archives")
            files[0] += 1
            expanded[0] += item.size
            if files[0] > MAX_FILES or expanded[0] > MAX_EXPANDED_BYTES:
                raise ValueError("Expanded PDK exceeds the configured safety limits")
            source = bundle.extractfile(item)
            if source is None:
                raise ValueError("Could not read a PDK archive member")
            with source:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("wb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)


def _unpack(archive: Path, destination: Path, expanded: list[int], files: list[int]) -> None:
    lower = archive.name.lower()
    if lower.endswith(".zip"):
        _extract_zip(archive, destination, expanded, files)
    elif lower.endswith((".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz")):
        _extract_tar(archive, destination, expanded, files)
    else:
        files[0] += 1
        if files[0] > MAX_FILES:
            raise ValueError("PDK contains too many files")
        destination.mkdir(parents=True, exist_ok=True)
        shutil.copy2(archive, destination / archive.name)
        expanded[0] += archive.stat().st_size


def _category(path: Path) -> str | None:
    name = path.name.lower()
    suffix = path.suffix.lower()
    if name.endswith((".lib", ".lib.gz")):
        return "liberty"
    if suffix == ".db":
        return "compiled_db"
    if suffix in {".lef", ".tlef"}:
        lowered = str(path).lower().replace("\\", "/")
        if "lef_techfiles" in lowered or "/techlef/" in lowered or "tech" in name or suffix == ".tlef":
            return "tech_lef"
        try:
            sample = path.read_bytes()[:2 * 1024 * 1024].decode("utf-8", errors="ignore")
            if re.search(r"(?m)^\s*MACRO\s+\S+", sample):
                return "cell_lef"
            if re.search(r"(?m)^\s*(LAYER|VIA|VIARULE)\s+\S+", sample):
                return "tech_lef"
        except OSError:
            pass
        return "cell_lef"
    if suffix in {".v", ".sv"}:
        return "verilog"
    if suffix in {".cdl", ".spi"}:
        return "cell_netlist"
    if suffix in {".spice", ".cir", ".ckt"} or "hspice" in name or "spectre" in name:
        return "device_models"
    if suffix in {".gds", ".gdsii", ".oas", ".oasis"}:
        return "layout"
    if suffix in {".spef", ".dspf", ".spf"}:
        return "parasitics"
    if suffix in {".lydrc", ".drc"}:
        return "drc"
    if suffix in {".lylvs", ".lvs"}:
        return "lvs"
    if "openrcx" in str(path).lower() or name.endswith("rcx_patterns.rules"):
        return "openrcx"
    if suffix == ".lyt":
        return "klayout_tech"
    if suffix == ".map":
        return "streamout_map"
    if suffix == ".lyp":
        return "layer_properties"
    if suffix == ".cal":
        return "commercial_lvs_calibre"
    if suffix == ".pvs":
        return "commercial_lvs_pvs"
    if suffix in {".r", ".c"} and ".rules." in name:
        return "commercial_rc_encrypted"
    if "tluplus" in name:
        return "commercial_rc_tluplus"
    if suffix in {".pdf", ".md", ".txt"} or name.startswith("readme"):
        return "documentation"
    if suffix == ".tf" or "milkyway" in str(path).lower() or (
        suffix == ".tcl" and "antenna" in name
    ):
        return "commercial_technology"
    return None


def _profile_from_file(content: Path) -> tuple[dict, Path] | None:
    candidates = sorted(content.rglob("opensemilab-pdk.json"))
    if not candidates:
        return None
    if len(candidates) > 1:
        raise ValueError("Only one opensemilab-pdk.json profile is allowed")
    try:
        profile = json.loads(candidates[0].read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("The private PDK profile is not valid JSON") from error
    if profile.get("schema") != PROFILE_SCHEMA:
        raise ValueError(f"Private PDK profile must use schema {PROFILE_SCHEMA}")
    return profile, candidates[0].parent


def _resolve_adapter(content: Path, profile_entry: tuple[dict, Path] | None) -> tuple[dict | None, list[str]]:
    warnings: list[str] = []
    if profile_entry:
        profile, profile_root = profile_entry
        configured_root = str(profile.get("pdk_root", "."))
        pdk_root = profile_root.resolve() if configured_root in {"", ".", "./"} else (profile_root / _safe_relative(configured_root)).resolve()
        try:
            pdk_root.relative_to(content.resolve())
        except ValueError as error:
            raise ValueError("Private PDK profile points outside its extracted package") from error
        pdk_name = str(profile.get("pdk", ""))
        scl = str(profile.get("scl", ""))
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", pdk_name) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", scl):
            raise ValueError("Private PDK profile contains an invalid PDK or standard-cell-library name")
        target = pdk_root / pdk_name
        if not (target / "libs.ref" / scl).is_dir() or not (target / "libs.tech" / "librelane").is_dir():
            warnings.append("The supplied profile does not point to a complete LibreLane/OpenPDKs layout")
            return None, warnings
        return {"pdk_root": str(pdk_root.relative_to(content)), "pdk": pdk_name, "scl": scl}, warnings

    candidates: list[tuple[Path, str, list[str]]] = []
    for libs_ref in content.rglob("libs.ref"):
        pdk_dir = libs_ref.parent
        if not (pdk_dir / "libs.tech" / "librelane").is_dir():
            continue
        libraries = sorted(path.name for path in libs_ref.iterdir() if path.is_dir())
        if libraries:
            candidates.append((pdk_dir.parent, pdk_dir.name, libraries))
    if len(candidates) == 1 and len(candidates[0][2]) == 1:
        root, pdk_name, libraries = candidates[0]
        return {"pdk_root": str(root.relative_to(content)), "pdk": pdk_name, "scl": libraries[0]}, warnings
    if candidates:
        warnings.append("Multiple PDKs or standard-cell libraries were found; add opensemilab-pdk.json to select one")
    else:
        warnings.append("No complete LibreLane/OpenPDKs adapter was found; import remains available for inventory and project mapping")
    return None, warnings


def _stack_variants(content: Path) -> list[str]:
    variants: set[str] = set()
    for path in content.rglob("*"):
        if not path.is_file() or "generated-adapter" in path.parts or _category(path) != "tech_lef":
            continue
        match = re.search(r"(?i)(\d+p\d+m(?:_\d+tm)?(?:_\d+k)?)", str(path))
        if match:
            variants.add(match.group(1).upper())
    return sorted(variants)


def _view_consistency(content: Path) -> dict[str, int | bool]:
    symbols: dict[str, set[str]] = {"lef": set(), "liberty": set(), "verilog": set()}
    patterns = {
        "cell_lef": ("lef", re.compile(r"(?m)^\s*MACRO\s+([A-Za-z_][A-Za-z0-9_$]*)")),
        "liberty": ("liberty", re.compile(r"(?m)\bcell\s*\(\s*[\"']?([A-Za-z_][A-Za-z0-9_$]*)")),
        "verilog": ("verilog", re.compile(r"(?m)^\s*module\s+([A-Za-z_][A-Za-z0-9_$]*)")),
    }
    for path in content.rglob("*"):
        if not path.is_file() or "generated-adapter" in path.parts:
            continue
        category = _category(path)
        if category not in patterns or path.stat().st_size > 64 * 1024 * 1024:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        key, pattern = patterns[category]
        symbols[key].update(pattern.findall(text))
    available = [items for items in symbols.values() if items]
    common = set.intersection(*available) if available else set()
    complete = len(available) < 2 or all(items == available[0] for items in available[1:])
    return {
        "lef_cells": len(symbols["lef"]), "liberty_cells": len(symbols["liberty"]),
        "verilog_modules": len(symbols["verilog"]), "common_cells": len(common),
        "consistent": complete,
    }


def _conversion_state(content: Path, inventory: dict[str, int], stack: str) -> dict:
    variants = _stack_variants(content)
    blockers: list[str] = []
    normalized = re.sub(r"[^A-Z0-9]", "", stack.upper())
    matching = [item for item in variants if re.sub(r"[^A-Z0-9]", "", item).startswith(normalized)]
    if len(matching) > 1:
        blockers.append("exact_stack_required")
    for category, code in (
        ("tech_lef", "technology_lef_missing"),
        ("cell_lef", "cell_lef_missing"),
        ("liberty", "liberty_missing"),
        ("verilog", "verilog_models_missing"),
        ("layout", "cell_layout_missing"),
        ("drc", "open_drc_deck_missing"),
        ("lvs", "open_lvs_deck_missing"),
        ("cell_netlist", "cell_lvs_netlist_missing"),
        ("openrcx", "open_rcx_rules_missing"),
    ):
        if not inventory.get(category):
            blockers.append(code)
    if not inventory.get("klayout_tech"):
        blockers.append(
            "klayout_tech_validation_required" if inventory.get("streamout_map") else "streamout_map_missing"
        )
    consistency = _view_consistency(content)
    if not consistency["consistent"]:
        blockers.append("cell_views_inconsistent")
    blockers.append("platform_config_validation_required")
    return {
        "status": "not_started",
        "stack_variants": variants,
        "selected_stack": None,
        "generated_at": None,
        "blockers": blockers,
        "view_consistency": consistency,
    }


def _scan(content: Path) -> tuple[dict[str, int], dict[str, bool], dict | None, list[str]]:
    inventory: dict[str, int] = {}
    for path in content.rglob("*"):
        if path.is_file() and "generated-adapter" not in path.parts:
            category = _category(path)
            if category:
                inventory[category] = inventory.get(category, 0) + 1
    profile_entry = _profile_from_file(content)
    adapter, warnings = _resolve_adapter(content, profile_entry)
    readiness = {
        "simulation": inventory.get("device_models", 0) > 0,
        "synthesis_timing": inventory.get("liberty", 0) > 0 and inventory.get("verilog", 0) > 0,
        "openroad_inputs": all(inventory.get(item, 0) > 0 for item in ("tech_lef", "cell_lef", "liberty", "verilog")),
        "physical": adapter is not None and all(inventory.get(item, 0) > 0 for item in ("tech_lef", "cell_lef", "liberty", "layout", "klayout_tech")),
        "drc": inventory.get("drc", 0) > 0,
        "lvs": inventory.get("lvs", 0) > 0 and inventory.get("cell_netlist", 0) > 0,
        "pex": inventory.get("openrcx", 0) > 0,
    }
    if inventory.get("compiled_db", 0):
        warnings.append("Compiled .db timing libraries are vendor-specific; provide Liberty .lib for open tools")
    if any(inventory.get(key, 0) for key in (
        "commercial_technology", "commercial_lvs_calibre", "commercial_lvs_pvs",
        "commercial_rc_encrypted", "commercial_rc_tluplus",
    )):
        warnings.append("Commercial-tool technology files were detected and will not be executed or treated as open-tool adapters")
    return inventory, readiness, adapter, warnings


def _public(manifest: dict) -> dict:
    result = {key: manifest[key] for key in (
        "schema", "id", "display_name", "version", "process", "stack", "imported_at",
        "archive_count", "file_count", "size_bytes", "inventory", "readiness", "warnings",
    )}
    result["conversion"] = manifest.get("conversion", {
        "status": "not_started", "stack_variants": [], "selected_stack": None,
        "generated_at": None, "blockers": [],
    })
    return result


def _write_manifest(record: Path, manifest: dict) -> None:
    temporary = record / "manifest.json.tmp"
    temporary.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    temporary.replace(record / "manifest.json")


async def import_private_pdk(
    uploads: list[UploadFile], display_name: str, version: str, process: str, stack: str,
    license_acknowledged: bool,
) -> dict:
    if not license_acknowledged:
        raise ValueError("You must confirm that you are authorized to use the uploaded PDK")
    if not uploads or len(uploads) > 24:
        raise ValueError("Select between 1 and 24 PDK packages")
    fields = {"display_name": display_name, "version": version, "process": process, "stack": stack}
    if any(not value.strip() or len(value.strip()) > 100 for value in fields.values()):
        raise ValueError("PDK name, version, process, and stack are required and limited to 100 characters")

    slug = re.sub(r"[^a-z0-9]+", "-", f"{display_name}-{version}".lower()).strip("-")[:48] or "private-pdk"
    identifier = f"{slug}-{uuid.uuid4().hex[:8]}"
    root = registry_root()
    incoming = root / ".incoming" / identifier
    content = incoming / "content"
    packages = incoming / "packages"
    final = root / identifier
    content.mkdir(parents=True, exist_ok=False)
    packages.mkdir(parents=True, exist_ok=True)
    uploaded = [0]
    expanded = [0]
    files = [0]
    try:
        for index, upload in enumerate(uploads):
            filename = Path(upload.filename or f"package-{index}").name
            if filename in {"", ".", ".."}:
                raise ValueError("Invalid upload filename")
            package = packages / f"{index:02d}-{filename}"
            with package.open("wb") as output:
                while chunk := await upload.read(1024 * 1024):
                    uploaded[0] += len(chunk)
                    if uploaded[0] > MAX_UPLOAD_BYTES:
                        raise ValueError("Uploaded PDK exceeds the configured size limit")
                    output.write(chunk)
            _unpack(package, content / f"package-{index:02d}", expanded, files)
        inventory, readiness, adapter, warnings = _scan(content)
        manifest = {
            "schema": REGISTRY_SCHEMA,
            "id": identifier,
            **{key: value.strip() for key, value in fields.items()},
            "imported_at": datetime.now(UTC).isoformat(),
            "archive_count": len(uploads),
            "file_count": files[0],
            "size_bytes": expanded[0],
            "inventory": inventory,
            "readiness": readiness,
            "warnings": warnings,
            "adapter": adapter,
            "conversion": _conversion_state(content, inventory, stack.strip()),
        }
        (incoming / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        shutil.rmtree(packages)
        root.mkdir(parents=True, exist_ok=True)
        incoming.rename(final)
        return _public(manifest)
    except Exception:
        shutil.rmtree(incoming, ignore_errors=True)
        raise
    finally:
        for upload in uploads:
            await upload.close()


async def extend_private_pdk(identifier: str, uploads: list[UploadFile], license_acknowledged: bool) -> dict:
    if not license_acknowledged:
        raise ValueError("You must confirm that you are authorized to use the uploaded PDK views")
    if not uploads or len(uploads) > 24:
        raise ValueError("Select between 1 and 24 supplementary PDK packages")
    record, manifest = _record(identifier)
    token = f"supplement-{uuid.uuid4().hex[:8]}"
    incoming = record / f".{token}"
    destination = record / "content" / token
    staged_content = incoming / "content"
    packages = incoming / "packages"
    staged_content.mkdir(parents=True)
    packages.mkdir(parents=True)
    uploaded = [0]
    expanded = [int(manifest.get("size_bytes", 0))]
    files = [int(manifest.get("file_count", 0))]
    selected_stack = manifest.get("conversion", {}).get("selected_stack")
    try:
        for index, upload in enumerate(uploads):
            filename = Path(upload.filename or f"package-{index}").name
            if filename in {"", ".", ".."}:
                raise ValueError("Invalid upload filename")
            package = packages / f"{index:02d}-{filename}"
            with package.open("wb") as output:
                while chunk := await upload.read(1024 * 1024):
                    uploaded[0] += len(chunk)
                    if uploaded[0] > MAX_UPLOAD_BYTES:
                        raise ValueError("Uploaded PDK exceeds the configured size limit")
                    output.write(chunk)
            _unpack(package, staged_content / f"package-{index:02d}", expanded, files)
        shutil.rmtree(packages)
        staged_content.rename(destination)
        shutil.rmtree(incoming, ignore_errors=True)
        shutil.rmtree(record / "content" / "generated-adapter", ignore_errors=True)
        shutil.rmtree(record / "compiled", ignore_errors=True)
        inventory, readiness, adapter, warnings = _scan(record / "content")
        manifest.update({
            "archive_count": int(manifest.get("archive_count", 0)) + len(uploads),
            "file_count": files[0], "size_bytes": expanded[0], "inventory": inventory,
            "readiness": readiness, "adapter": adapter, "warnings": warnings,
            "conversion": _conversion_state(record / "content", inventory, manifest.get("stack", "")),
        })
        _write_manifest(record, manifest)
        if selected_stack:
            try:
                return convert_private_pdk(identifier, selected_stack)
            except Exception:
                manifest["conversion"]["status"] = "compilation_failed"
                manifest["conversion"]["selected_stack"] = selected_stack
                manifest["warnings"].append(
                    "Supplementary views were stored, but internal recompilation failed; retry regeneration"
                )
                _write_manifest(record, manifest)
                return _public(manifest)
        return _public(manifest)
    except Exception:
        shutil.rmtree(incoming, ignore_errors=True)
        shutil.rmtree(destination, ignore_errors=True)
        raise
    finally:
        for upload in uploads:
            await upload.close()


def list_private_pdks() -> list[dict]:
    root = registry_root()
    if not root.is_dir():
        return []
    result = []
    for manifest_path in root.glob("*/manifest.json"):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest.get("schema") == REGISTRY_SCHEMA and SAFE_ID.fullmatch(manifest.get("id", "")):
                if "conversion" not in manifest:
                    content = manifest_path.parent / "content"
                    inventory, readiness, adapter, warnings = _scan(content)
                    manifest["inventory"] = inventory
                    manifest["readiness"] = readiness
                    manifest["adapter"] = adapter
                    manifest["warnings"] = warnings
                    manifest["conversion"] = _conversion_state(content, inventory, manifest.get("stack", ""))
                    temporary = manifest_path.with_suffix(".json.tmp")
                    temporary.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
                    temporary.replace(manifest_path)
                result.append(_public(manifest))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, KeyError):
            continue
    return sorted(result, key=lambda item: item["imported_at"], reverse=True)


def delete_private_pdk(identifier: str) -> None:
    if not SAFE_ID.fullmatch(identifier):
        raise ValueError("Invalid private PDK identifier")
    target = registry_root() / identifier
    if not (target / "manifest.json").is_file():
        raise FileNotFoundError(identifier)
    shutil.rmtree(target)


def _record(identifier: str) -> tuple[Path, dict]:
    if not SAFE_ID.fullmatch(identifier):
        raise ValueError("Invalid private PDK identifier")
    record = registry_root() / identifier
    manifest_path = record / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(identifier)
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Private PDK registry entry is unreadable") from error
    if manifest.get("schema") != REGISTRY_SCHEMA or manifest.get("id") != identifier:
        raise ValueError("Private PDK registry entry is invalid")
    return record, manifest


def _copy_views(content: Path, destination: Path, selected_stack: str | None) -> dict[str, int]:
    folder_by_category = {
        "tech_lef": "techlef", "cell_lef": "lef", "liberty": "lib", "verilog": "verilog",
        "layout": "gds", "device_models": "spice", "cell_netlist": "cdl", "drc": "drc", "lvs": "lvs",
        "openrcx": "openrcx", "klayout_tech": "klayout", "streamout_map": "klayout",
        "layer_properties": "klayout",
    }
    copied: dict[str, int] = {}
    selected_token = selected_stack.lower() if selected_stack else None
    for source in content.rglob("*"):
        if not source.is_file() or "generated-adapter" in source.parts:
            continue
        category = _category(source)
        folder = folder_by_category.get(category or "")
        if not folder:
            continue
        if category == "tech_lef" and selected_token:
            available = re.search(r"(?i)(\d+p\d+m(?:_\d+tm)?(?:_\d+k)?)", str(source))
            if available and available.group(1).lower() != selected_token:
                continue
        target_dir = destination / folder
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / source.name
        counter = 2
        while target.exists():
            target = target_dir / f"{source.stem}-{counter}{source.suffix}"
            counter += 1
        shutil.copy2(source, target)
        copied[category] = copied.get(category, 0) + 1
    return copied


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _platform_analysis(library: Path) -> dict:
    routing_layers: list[str] = []
    sites: set[str] = set()
    power_pins: set[str] = set()
    ground_pins: set[str] = set()
    for path in sorted((library / "techlef").glob("*")):
        if not path.is_file() or path.stat().st_size > 64 * 1024 * 1024:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        current_layer: str | None = None
        for line in text.splitlines():
            layer_match = re.match(r"\s*LAYER\s+([A-Za-z_][A-Za-z0-9_$]*)", line, re.IGNORECASE)
            if layer_match:
                current_layer = layer_match.group(1)
            elif current_layer and re.match(r"\s*TYPE\s+ROUTING\s*;", line, re.IGNORECASE):
                routing_layers.append(current_layer)
            elif current_layer and re.match(rf"\s*END\s+{re.escape(current_layer)}\b", line, re.IGNORECASE):
                current_layer = None
        sites.update(re.findall(r"(?m)^\s*SITE\s+([A-Za-z_][A-Za-z0-9_$]*)", text))
    for path in sorted((library / "lef").glob("*")):
        if not path.is_file() or path.stat().st_size > 64 * 1024 * 1024:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        sites.update(re.findall(r"(?m)^\s*SITE\s+([A-Za-z_][A-Za-z0-9_$]*)\s*;", text))
        current_pin: str | None = None
        for line in text.splitlines():
            pin_match = re.match(r"\s*PIN\s+([A-Za-z_][A-Za-z0-9_$]*)", line, re.IGNORECASE)
            if pin_match:
                current_pin = pin_match.group(1)
                continue
            use_match = re.match(r"\s*USE\s+(POWER|GROUND)\s*;", line, re.IGNORECASE)
            if current_pin and use_match:
                (power_pins if use_match.group(1).upper() == "POWER" else ground_pins).add(current_pin)
            if current_pin and re.match(rf"\s*END\s+{re.escape(current_pin)}\b", line, re.IGNORECASE):
                current_pin = None
    unique_layers = list(dict.fromkeys(routing_layers))
    return {
        "routing_layers": unique_layers,
        "sites": sorted(sites),
        "power_pins": sorted(power_pins),
        "ground_pins": sorted(ground_pins),
    }


def _write_generated_config(pdk_dir: Path, library: Path, scl: str, analysis: dict, copied: dict[str, int]) -> None:
    config_dir = pdk_dir / "libs.tech" / "librelane" / scl
    config_dir.mkdir(parents=True, exist_ok=True)
    base = "$::env(PDK_ROOT)/$::env(PDK)/libs.ref/$::env(STD_CELL_LIBRARY)"
    config = [
        "# Generated locally by OpenSemiLab BYOPDK.",
        "# Draft configuration: production use requires completion of every TODO and validation.",
        f"set ::env(TECH_LEFS) [dict create nom_* [glob {base}/techlef/*]]",
        f"set ::env(CELL_LEFS) [glob {base}/lef/*]",
        f"set ::env(LIB) [dict create nom_* [glob {base}/lib/*]]",
        f"set ::env(CELL_VERILOG_MODELS) [glob {base}/verilog/*]",
    ]
    if copied.get("layout"):
        config.append(f"set ::env(CELL_GDS) [glob {base}/gds/*]")
    if copied.get("klayout_tech"):
        config.append(f"set ::env(KLAYOUT_TECH) [lindex [glob {base}/klayout/*.lyt] 0]")
    if len(analysis["sites"]) == 1:
        config.append(f"set ::env(PLACE_SITE) {analysis['sites'][0]}")
    else:
        config.append("# TODO: set ::env(PLACE_SITE) <validated placement site>")
    if analysis["routing_layers"]:
        config.extend((
            f"set ::env(RT_MIN_LAYER) {analysis['routing_layers'][0]}",
            f"set ::env(RT_MAX_LAYER) {analysis['routing_layers'][-1]}",
        ))
    else:
        config.append("# TODO: set validated routing layer limits")
    if len(analysis["power_pins"]) == 1 and len(analysis["ground_pins"]) == 1:
        config.extend((
            f"set ::env(VDD_PIN) {analysis['power_pins'][0]}",
            f"set ::env(GND_PIN) {analysis['ground_pins'][0]}",
        ))
    else:
        config.append("# TODO: set validated VDD_PIN and GND_PIN")
    config.extend((
        "# TODO: set validated tie-high, tie-low and minimum-drive buffer cells.",
        "# TODO: set tracks, tap/endcap/filler cells and PDN geometry.",
    ))
    (config_dir / "config.tcl").write_text("\n".join(config) + "\n", encoding="utf-8")
    (pdk_dir / "libs.tech" / "librelane" / "config.tcl").write_text(
        "# OpenSemiLab generated private PDK entry point.\n", encoding="utf-8"
    )


def _required_inputs(blockers: list[str], inventory: dict[str, int], selected: str | None) -> dict:
    guidance = {
        "cell_layout_missing": {"accept": [".gds", ".gdsii", ".oas", ".oasis"], "purpose": "standard-cell layout export"},
        "streamout_map_missing": {"accept": [".lyt"], "purpose": "validated KLayout technology/stream-out configuration"},
        "klayout_tech_validation_required": {"accept": [".lyt"], "purpose": "validate the uploaded vendor layer map as a KLayout technology"},
        "open_drc_deck_missing": {"accept": [".lydrc", ".drc"], "purpose": "validated open DRC deck"},
        "open_lvs_deck_missing": {"accept": [".lylvs", ".lvs"], "purpose": "validated open LVS deck and cell CDL/SPICE"},
        "cell_lvs_netlist_missing": {"accept": [".cdl", ".spi"], "purpose": "standard-cell schematic netlist for LVS"},
        "open_rcx_rules_missing": {"accept": ["OpenRCX rules"], "purpose": "calibrated RC extraction rules"},
        "platform_config_validation_required": {"accept": ["reviewed config.tcl"], "purpose": "site, power pins, routing, tracks, cells and PDN validation"},
    }
    return {
        "schema": COMPILATION_SCHEMA,
        "selected_stack": selected,
        "pending": [{"code": code, **guidance.get(code, {"accept": [], "purpose": "resolve validation requirement"})} for code in blockers],
        "commercial_references_detected": sum(inventory.get(key, 0) for key in (
            "commercial_technology", "commercial_lvs_calibre", "commercial_lvs_pvs",
            "commercial_rc_encrypted", "commercial_rc_tluplus",
        )),
        "notice": "Commercial decks and binary databases are reference inputs only; they are not treated as validated open-tool rules.",
    }


def _write_bundle(record: Path, adapter: Path, compile_id: str) -> tuple[Path, int, str]:
    compiled = record / "compiled"
    compiled.mkdir(parents=True, exist_ok=True)
    target = compiled / "opensemilab-pdk-adapter.zip"
    temporary = compiled / f".{compile_id}.zip"
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for path in sorted(adapter.rglob("*")):
            if path.is_file():
                bundle.write(path, Path("opensemilab-pdk-adapter") / path.relative_to(adapter))
    temporary.replace(target)
    return target, target.stat().st_size, _sha256(target)


def compiled_bundle(identifier: str) -> Path:
    record, manifest = _record(identifier)
    if not manifest.get("conversion", {}).get("bundle_available"):
        raise FileNotFoundError(identifier)
    bundle = record / "compiled" / "opensemilab-pdk-adapter.zip"
    if not bundle.is_file():
        raise FileNotFoundError(identifier)
    return bundle


def convert_private_pdk(identifier: str, stack_variant: str | None = None) -> dict:
    record, manifest = _record(identifier)
    content = record / "content"
    inventory, _, existing_adapter, scan_warnings = _scan(content)
    state = _conversion_state(content, inventory, manifest["stack"])
    variants = state["stack_variants"]
    selected = stack_variant.strip().upper() if stack_variant else None
    if selected and not re.fullmatch(r"[A-Z0-9_.-]{2,80}", selected):
        raise ValueError("Invalid stack variant")
    if selected and variants and selected not in variants:
        raise ValueError("Selected stack variant was not found in the imported technology LEFs")
    if not selected:
        normalized = re.sub(r"[^A-Z0-9]", "", manifest["stack"].upper())
        matches = [item for item in variants if re.sub(r"[^A-Z0-9]", "", item).startswith(normalized)]
        if len(matches) == 1:
            selected = matches[0]
        elif len(variants) == 1:
            selected = variants[0]
        elif len(matches) > 1 or len(variants) > 1:
            raise ValueError("Select the exact metal stack before converting the PDK")

    pdk_name = re.sub(r"[^a-z0-9]+", "_", manifest["display_name"].lower()).strip("_")[:48] or "private_pdk"
    scl = f"{pdk_name}_sc"
    adapter_parent = content / "generated-adapter"
    temporary = Path(tempfile.mkdtemp(prefix=".adapter-", dir=record))
    compile_id = uuid.uuid4().hex
    try:
        pdk_dir = temporary / pdk_name
        library = pdk_dir / "libs.ref" / scl
        copied = _copy_views(content, library, selected)
        analysis = _platform_analysis(library)
        _write_generated_config(pdk_dir, library, scl, analysis, copied)
        translation = translate_commercial_references(content, temporary / "translations", selected)
        (temporary / "opensemilab-pdk.json").write_text(json.dumps({
            "schema": PROFILE_SCHEMA, "pdk_root": ".", "pdk": pdk_name, "scl": scl,
        }, indent=2) + "\n", encoding="utf-8")
        blockers = [code for code in state["blockers"] if code != "exact_stack_required"]
        status = "generated_with_blockers" if blockers else "generated"
        conversion = {
            **state, "status": status, "selected_stack": selected,
            "generated_at": datetime.now(UTC).isoformat(), "blockers": blockers,
            "normalized_views": copied, "compile_id": compile_id,
            "translation": translation,
            "platform_analysis": {
                "routing_layer_count": len(analysis["routing_layers"]),
                "site_count": len(analysis["sites"]),
                "power_pin_count": len(analysis["power_pins"]),
                "ground_pin_count": len(analysis["ground_pins"]),
            },
        }
        (temporary / "conversion-report.json").write_text(json.dumps(conversion, indent=2) + "\n", encoding="utf-8")
        (temporary / "REQUIRED_INPUTS.json").write_text(
            json.dumps(_required_inputs(blockers, inventory, selected), indent=2) + "\n", encoding="utf-8"
        )
        (temporary / "README.md").write_text(
            "# OpenSemiLab private PDK adapter\n\n"
            "Generated and stored locally. This archive excludes the original uploaded packages.\n\n"
            "`translations/` contains auditable commercial-to-open drafts and an intermediate rule model. "
            "They do not replace foundry sign-off or licensed export of M31 GDS/CDL.\n\n"
            "Review `conversion-report.json`, `REQUIRED_INPUTS.json`, and every TODO in the generated "
            "LibreLane configuration before physical use. A generated adapter is not foundry sign-off.\n",
            encoding="utf-8",
        )
        checksums = []
        for path in sorted(temporary.rglob("*")):
            if path.is_file() and path.name != "SHA256SUMS":
                checksums.append(f"{_sha256(path)}  {path.relative_to(temporary).as_posix()}")
        (temporary / "SHA256SUMS").write_text("\n".join(checksums) + "\n", encoding="utf-8")
        if adapter_parent.exists():
            shutil.rmtree(adapter_parent)
        temporary.rename(adapter_parent)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise

    bundle, bundle_size, bundle_sha256 = _write_bundle(record, adapter_parent, compile_id)
    adapter_manifest_sha256 = _sha256(adapter_parent / "SHA256SUMS")
    conversion.update({
        "bundle_available": True,
        "bundle_size_bytes": bundle_size,
        "bundle_sha256": bundle_sha256,
        "manifest_sha256": adapter_manifest_sha256,
    })

    adapter = {"pdk_root": "generated-adapter", "pdk": pdk_name, "scl": scl}
    manifest["adapter"] = adapter
    manifest["conversion"] = conversion
    manifest["warnings"] = [warning for warning in scan_warnings if not warning.startswith("No complete LibreLane")]
    manifest["readiness"] = {
        "simulation": inventory.get("device_models", 0) > 0,
        "synthesis_timing": inventory.get("liberty", 0) > 0 and inventory.get("verilog", 0) > 0,
        "openroad_inputs": all(inventory.get(item, 0) > 0 for item in ("tech_lef", "cell_lef", "liberty", "verilog")),
        "physical": not any(code in conversion["blockers"] for code in ("technology_lef_missing", "cell_lef_missing", "liberty_missing", "verilog_models_missing", "cell_layout_missing", "streamout_map_missing", "cell_views_inconsistent", "platform_config_validation_required")),
        "drc": inventory.get("drc", 0) > 0,
        "lvs": inventory.get("lvs", 0) > 0 and inventory.get("cell_netlist", 0) > 0,
        "pex": inventory.get("openrcx", 0) > 0,
    }
    _write_manifest(record, manifest)
    return _public(manifest)
