from __future__ import annotations

import json
import os
import re
import shutil
import tarfile
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import BinaryIO

from fastapi import UploadFile


PROFILE_SCHEMA = "opensemilab.pdk-profile/v1"
REGISTRY_SCHEMA = "opensemilab.private-pdk/v1"
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
        shutil.copy2(archive, destination / archive.name)
        expanded[0] += archive.stat().st_size


def _category(path: Path) -> str | None:
    name = path.name.lower()
    suffix = path.suffix.lower()
    if name.endswith((".lib", ".lib.gz")):
        return "liberty"
    if suffix == ".db":
        return "compiled_db"
    if suffix == ".lef":
        return "tech_lef" if "tech" in name else "cell_lef"
    if suffix in {".v", ".sv"}:
        return "verilog"
    if suffix in {".spice", ".cir", ".ckt", ".cdl", ".spi"} or "hspice" in name or "spectre" in name:
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
    if suffix in {".map", ".lyt", ".lyp"}:
        return "layer_maps"
    if suffix in {".pdf", ".md", ".txt"} or name.startswith("readme"):
        return "documentation"
    if "tluplus" in name or suffix == ".tf" or "milkyway" in str(path).lower():
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


def _scan(content: Path) -> tuple[dict[str, int], dict[str, bool], dict | None, list[str]]:
    inventory: dict[str, int] = {}
    for path in content.rglob("*"):
        if path.is_file():
            category = _category(path)
            if category:
                inventory[category] = inventory.get(category, 0) + 1
    profile_entry = _profile_from_file(content)
    adapter, warnings = _resolve_adapter(content, profile_entry)
    readiness = {
        "simulation": inventory.get("device_models", 0) > 0,
        "synthesis_timing": inventory.get("liberty", 0) > 0 and inventory.get("verilog", 0) > 0,
        "physical": adapter is not None and inventory.get("cell_lef", 0) > 0,
        "drc": inventory.get("drc", 0) > 0,
        "lvs": inventory.get("lvs", 0) > 0,
        "pex": inventory.get("openrcx", 0) > 0,
    }
    if inventory.get("compiled_db", 0):
        warnings.append("Compiled .db timing libraries are vendor-specific; provide Liberty .lib for open tools")
    if inventory.get("commercial_technology", 0):
        warnings.append("Commercial-tool technology files were detected and will not be executed or treated as open-tool adapters")
    return inventory, readiness, adapter, warnings


def _public(manifest: dict) -> dict:
    return {key: manifest[key] for key in (
        "schema", "id", "display_name", "version", "process", "stack", "imported_at",
        "archive_count", "file_count", "size_bytes", "inventory", "readiness", "warnings",
    )}


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


def list_private_pdks() -> list[dict]:
    root = registry_root()
    if not root.is_dir():
        return []
    result = []
    for manifest_path in root.glob("*/manifest.json"):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest.get("schema") == REGISTRY_SCHEMA and SAFE_ID.fullmatch(manifest.get("id", "")):
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
