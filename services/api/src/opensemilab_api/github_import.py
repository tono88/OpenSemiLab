import io
import json
import re
import tarfile
import uuid
from datetime import UTC, datetime
from pathlib import PurePosixPath
from urllib.parse import quote, urlparse

import httpx


MAX_ARCHIVE_BYTES = 12_000_000
MAX_PROJECT_BYTES = 3_000_000
MAX_FILES = 250
TEXT_EXTENSIONS = {
    ".v", ".sv", ".vh", ".svh", ".vhd", ".vhdl", ".pcf", ".sdc",
    ".spice", ".cir", ".ckt", ".lib", ".sch", ".sym", ".tcl", ".yaml",
    ".yml", ".json", ".xml", ".md", ".txt", ".py",
}
IGNORED_PARTS = {".git", "node_modules", "dist", "build", "target", "vendor", "__pycache__"}
MODULE_RE = re.compile(r"\bmodule\s+([A-Za-z_][A-Za-z0-9_$]*)\b")


def parse_github_repository(value: str) -> tuple[str, str]:
    parsed = urlparse(value.strip())
    parts = [part for part in parsed.path.split("/") if part]
    if parsed.scheme != "https" or parsed.hostname != "github.com" or parsed.username or parsed.password:
        raise ValueError("Only public https://github.com repository URLs are supported")
    if len(parts) != 2 or parsed.query or parsed.fragment:
        raise ValueError("Use the repository root URL, for example https://github.com/owner/project")
    owner, repository = parts
    repository = repository.removesuffix(".git")
    safe = re.compile(r"^[A-Za-z0-9_.-]+$")
    if not safe.fullmatch(owner) or not safe.fullmatch(repository):
        raise ValueError("Invalid GitHub repository URL")
    return owner, repository


def file_role(path: str) -> str:
    lower = path.lower()
    name = PurePosixPath(lower).name
    suffix = PurePosixPath(lower).suffix
    if suffix in {".pcf", ".sdc"} or "constraint" in lower:
        return "constraint"
    if any(part in lower.split("/") for part in ("tb", "test", "tests", "testbench", "verification")) or name.startswith(("tb_", "test_")):
        return "testbench"
    if suffix in {".v", ".sv", ".vh", ".svh", ".vhd", ".vhdl"}:
        return "source"
    if suffix in {".spice", ".cir", ".ckt", ".lib"}:
        return "simulation"
    if suffix in {".sch", ".sym"}:
        return "configuration"
    if suffix in {".md", ".txt"}:
        return "documentation"
    return "configuration"


def infer_top(files: list[dict[str, str]], repository: str) -> str:
    modules: list[tuple[str, str]] = []
    for item in files:
        if item["role"] != "source":
            continue
        modules.extend((name, item["path"]) for name in MODULE_RE.findall(item["content"]))
    if not modules:
        return "top"
    normalized_repo = repository.replace("-", "_").lower()
    preferred = [normalized_repo, "top", f"{normalized_repo}_top"]
    for candidate in preferred:
        match = next((name for name, _ in modules if name.lower() == candidate), None)
        if match:
            return match
    non_test = [(name, path) for name, path in modules if not re.search(r"(^|[/_])(tb|test|formal)([/_]|$)", f"{path}/{name}", re.I)]
    return (non_test or modules)[0][0]


def build_project(owner: str, repository: str, branch: str, members: list[tarfile.TarInfo], archive: tarfile.TarFile) -> dict:
    files: list[dict[str, str]] = []
    total = 0
    for member in members:
        if not member.isfile():
            continue
        raw_path = PurePosixPath(member.name)
        relative = PurePosixPath(*raw_path.parts[1:])
        if not relative.parts or ".." in relative.parts or any(part in IGNORED_PARTS for part in relative.parts):
            continue
        if relative.suffix.lower() not in TEXT_EXTENSIONS or member.size > 500_000:
            continue
        extracted = archive.extractfile(member)
        if extracted is None:
            continue
        content = extracted.read().decode("utf-8", errors="replace")
        size = len(content.encode("utf-8"))
        if total + size > MAX_PROJECT_BYTES or len(files) >= MAX_FILES:
            break
        path = relative.as_posix()
        if path == "project.json":
            path = "upstream-project.json"
        files.append({"path": path, "role": file_role(path), "content": content})
        total += size
    if not files:
        raise ValueError("The repository does not contain supported text-based design files")

    hdl = [item for item in files if item["role"] == "source"]
    top = infer_top(files, repository)
    language = "systemverilog" if any(item["path"].lower().endswith(".sv") for item in hdl) else "verilog" if hdl else "text"
    kind = "fpga_prototype" if hdl else "blank_project"
    manifest = {
        "schema": "opensemilab.project/v3",
        "name": repository,
        "kind": kind,
        "pdk": "sky130A",
        "execution": {"rtl_top": top, "fpga_top": top} if hdl else {},
        "provenance": {
            "repository": f"https://github.com/{owner}/{repository}",
            "branch": branch,
            "imported_by": "OpenSemiLab GitHub importer",
        },
    }
    files = [item for item in files if item["path"] != "project.json"]
    files.append({"path": "project.json", "role": "configuration", "content": json.dumps(manifest, indent=2) + "\n"})
    if not any(PurePosixPath(item["path"]).name.lower().startswith("readme") for item in files):
        files.append({
            "path": "README.opensemilab.md",
            "role": "documentation",
            "content": f"# {repository}\n\nImported from https://github.com/{owner}/{repository} ({branch}).\n",
        })
    now = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return {
        "id": str(uuid.uuid4()), "name": repository, "kind": kind, "pdk": "sky130A",
        "level": "expert", "language": language, "createdAt": now, "updatedAt": now, "files": files,
    }


def import_public_github_repository(value: str, client: httpx.Client | None = None) -> dict:
    owner, repository = parse_github_repository(value)
    owns_client = client is None
    session = client or httpx.Client(timeout=20, follow_redirects=False, headers={"Accept": "application/vnd.github+json"})
    try:
        metadata = session.get(f"https://api.github.com/repos/{quote(owner)}/{quote(repository)}")
        if metadata.status_code == 404:
            raise ValueError("GitHub repository not found or not public")
        metadata.raise_for_status()
        branch = str(metadata.json().get("default_branch") or "main")
        archive_url = f"https://codeload.github.com/{quote(owner)}/{quote(repository)}/tar.gz/{quote(branch, safe='')}"
        with session.stream("GET", archive_url) as response:
            response.raise_for_status()
            payload = bytearray()
            for chunk in response.iter_bytes():
                payload.extend(chunk)
                if len(payload) > MAX_ARCHIVE_BYTES:
                    raise ValueError("GitHub repository archive exceeds the 12 MB import limit")
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
            return build_project(owner, repository, branch, archive.getmembers(), archive)
    except httpx.HTTPError as error:
        raise ValueError(f"Could not download the public GitHub repository: {error}") from error
    finally:
        if owns_client:
            session.close()
