import io
import json
import tarfile
import zipfile
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from opensemilab_api.github_import import import_public_github_repository, parse_github_repository
from opensemilab_api.main import app
from opensemilab_api.eda import EdaRunRequest

client = TestClient(app)


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_educational_simulation_is_self_describing():
    response = client.post(
        "/api/v1/simulations/pn-junction",
        json={"name": "Test diode", "engine": "educational", "device": {}, "sweep": {}, "numerics": {}},
    )
    assert response.status_code == 200
    result = response.json()
    assert result["converged"] is True
    assert result["provenance"]["authoritative"] is False
    assert len(result["provenance"]["input_sha256"]) == 64
    assert {series["name"] for series in result["series"]} == {
        "potential", "electric_field", "charge_density", "iv"
    }


def test_invalid_sweep_is_rejected():
    response = client.post(
        "/api/v1/simulations/pn-junction",
        json={"sweep": {"start_v": 1, "stop_v": 0}},
    )
    assert response.status_code == 422


def test_unavailable_devsim_is_explicit():
    response = client.post(
        "/api/v1/simulations/pn-junction",
        json={"engine": "devsim"},
    )
    assert response.status_code == 409
    assert "DEVSIM" in response.json()["detail"]


def test_design_templates_cover_major_flows():
    response = client.get("/api/v1/design/templates")
    assert response.status_code == 200
    kinds = {item["id"] for item in response.json()}
    assert {"microcontroller", "sensor_interface", "analog_block", "rf_frontend", "blank_project"} <= kinds


def test_private_pdk_import_is_sanitized_and_deletable(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENSEMILAB_PDK_ROOT", str(tmp_path / "pdks"))
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("views/cells.lib", "library(test) {}")
        bundle.writestr("views/cells.v", "module INV(input A, output Y); assign Y=~A; endmodule")
        bundle.writestr("views/cells.lef", "VERSION 5.8 ;\nEND LIBRARY")
    response = client.post(
        "/api/v1/pdks/import",
        data={
            "display_name": "Private teaching kit", "version": "1.0", "process": "demo",
            "stack": "1P3M", "license_acknowledged": "true",
        },
        files=[("files", ("kit.zip", archive.getvalue(), "application/zip"))],
    )
    assert response.status_code == 201
    pdk = response.json()
    assert pdk["inventory"]["liberty"] == 1
    assert pdk["readiness"]["synthesis_timing"] is True
    assert pdk["readiness"]["physical"] is False
    assert "adapter" not in pdk
    assert "content" not in json.dumps(pdk).lower()

    listed = client.get("/api/v1/pdks")
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [pdk["id"]]
    deleted = client.delete(f"/api/v1/pdks/{pdk['id']}")
    assert deleted.status_code == 204
    assert client.get("/api/v1/pdks").json() == []


def test_private_pdk_import_rejects_zip_slip(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENSEMILAB_PDK_ROOT", str(tmp_path / "pdks"))
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("../escape.lib", "not allowed")
    response = client.post(
        "/api/v1/pdks/import",
        data={
            "display_name": "Unsafe kit", "version": "1.0", "process": "demo",
            "stack": "1P3M", "license_acknowledged": "true",
        },
        files=[("files", ("unsafe.zip", archive.getvalue(), "application/zip"))],
    )
    assert response.status_code == 422
    assert "unsafe path" in response.json()["detail"].lower()


def test_private_pdk_profile_resolves_relative_librelane_adapter(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENSEMILAB_PDK_ROOT", str(tmp_path / "pdks"))
    archive = io.BytesIO()
    profile = {
        "schema": "opensemilab.pdk-profile/v1",
        "pdk_root": ".",
        "pdk": "local180",
        "scl": "cells7t",
    }
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("opensemilab-pdk.json", json.dumps(profile))
        bundle.writestr("local180/libs.ref/cells7t/lef/cells.lef", "VERSION 5.8 ;\nEND LIBRARY")
        bundle.writestr("local180/libs.tech/librelane/config.tcl", "set ::env(PDK) local180")
    response = client.post(
        "/api/v1/pdks/import",
        data={
            "display_name": "Private physical kit", "version": "1.0", "process": "demo",
            "stack": "1P3M", "license_acknowledged": "true",
        },
        files=[("files", ("physical.zip", archive.getvalue(), "application/zip"))],
    )
    assert response.status_code == 201
    pdk = response.json()
    assert pdk["readiness"]["physical"] is True
    assert "adapter" not in pdk
    assert "local180" not in json.dumps(pdk)


def test_blank_project_returns_an_organized_optional_flow():
    response = client.post("/api/v1/design/plan", json={
        "name": "Custom project", "kind": "blank_project", "pdk": "sky130A",
        "level": "guided", "language": "systemverilog"
    })
    assert response.status_code == 200
    result = response.json()
    assert result["runner_available"] is False
    assert [stage["id"] for stage in result["stages"]] == ["design", "verification", "implementation"]


def test_microcontroller_plan_connects_rtl_to_gds():
    response = client.post("/api/v1/design/plan", json={
        "name": "Teaching MCU", "kind": "microcontroller", "pdk": "sky130A",
        "level": "engineering", "language": "systemverilog"
    })
    assert response.status_code == 200
    result = response.json()
    assert result["runner_available"] is True
    assert "lint, simulation and synthesis" in result["notice"]
    tools = {tool for stage in result["stages"] for tool in stage["tools"]}
    assert {"Yosys", "LibreLane", "OpenROAD", "KLayout"} <= tools


def test_sensor_interface_connects_digital_and_spice_execution():
    response = client.post("/api/v1/design/plan", json={
        "name": "Temperature sensor", "kind": "sensor_interface", "pdk": "gf180mcuD",
        "level": "engineering", "language": "systemverilog"
    })
    assert response.status_code == 200
    result = response.json()
    assert result["runner_available"] is True
    assert "SPICE simulation" in result["notice"]
    ready_stages = {stage["id"] for stage in result["stages"] if stage["status"] == "ready"}
    assert {"requirements", "frontend", "digital"} <= ready_stages


def test_gt2n_is_accepted_as_research_scaffold_not_physical_runner():
    response = client.post("/api/v1/design/plan", json={
        "name": "GT2N benchmark", "kind": "microcontroller", "pdk": "gt2n",
        "level": "engineering", "language": "systemverilog"
    })
    assert response.status_code == 200
    result = response.json()
    assert "not connected" in result["notice"]
    physical = next(stage for stage in result["stages"] if stage["id"] == "physical")
    assert physical["status"] == "adapter_pending"


def test_physical_job_requires_bounded_options():
    missing = client.post("/api/v1/eda/jobs", json={
        "action": "physical", "top": "top", "sources": {"rtl/top.sv": "module top; endmodule"}
    })
    assert missing.status_code == 422

    unsupported = client.post("/api/v1/eda/jobs", json={
        "action": "physical", "top": "top", "sources": {"rtl/top.sv": "module top; endmodule"},
        "physical": {"pdk": "ihp-sg13g2", "clock_port": "clk"}
    })
    assert unsupported.status_code == 422

    automatic = EdaRunRequest.model_validate({
        "action": "physical", "top": "top", "sources": {"rtl/top.sv": "module top; endmodule"},
        "physical": {"pdk": "sky130A", "clock_port": "clk", "floorplan_mode": "auto"},
    })
    assert automatic.physical.floorplan_mode == "auto"
    assert EdaRunRequest.model_validate({
        "action": "physical", "top": "top", "sources": {"rtl/top.sv": "module top; endmodule"},
        "physical": {"pdk": "sky130A", "sdc_content": "create_clock -period 25 [get_ports clk]\n"},
    }).physical.sdc_content.startswith("create_clock")

    unsafe_sdc = client.post("/api/v1/eda/jobs", json={
        "action": "physical", "top": "top", "sources": {"rtl/top.sv": "module top; endmodule"},
        "physical": {"pdk": "sky130A", "sdc_content": "[exec id]"},
    })
    assert unsafe_sdc.status_code == 422


def test_physical_job_cancel_is_forwarded_to_worker():
    forwarded = httpx.Response(202, json={"job_id": "abc123", "status": "cancelling"})
    with patch("opensemilab_api.main.httpx.post", return_value=forwarded) as post:
        response = client.post("/api/v1/eda/jobs/abc123/cancel")
    assert response.status_code == 202
    assert response.json()["status"] == "cancelling"
    post.assert_called_once_with("http://localhost:9000/jobs/abc123/cancel", timeout=15)


def test_specialized_eda_actions_share_the_validated_contract():
    for action in ("formal", "fpga", "xyce", "openems", "xschem", "gds3d", "cace"):
        request = EdaRunRequest(action=action, top="top", sources={"input.txt": "bounded"}, adapter={"depth": 20})
        assert request.action == action


def test_github_import_rejects_non_github_and_nested_urls():
    for url in ("http://github.com/owner/repo", "https://example.com/owner/repo", "https://github.com/owner/repo/tree/main"):
        try:
            parse_github_repository(url)
        except ValueError:
            pass
        else:
            raise AssertionError(f"unsafe URL accepted: {url}")


def test_github_import_builds_portable_project_and_infers_top():
    archive_bytes = io.BytesIO()
    with tarfile.open(fileobj=archive_bytes, mode="w:gz") as archive:
        for name, content in {
            "demo-main/rtl/demo.v": "module demo(input clk, output led); assign led=clk; endmodule\n",
            "demo-main/tb/tb_demo.v": "module tb_demo; demo dut(); endmodule\n",
            "demo-main/README.md": "# Demo\n",
            "demo-main/node_modules/ignored.v": "module ignored; endmodule\n",
        }.items():
            data = content.encode()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
    payload = archive_bytes.getvalue()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.github.com":
            return httpx.Response(200, json={"default_branch": "main"})
        if request.url.host == "codeload.github.com":
            return httpx.Response(200, content=payload)
        return httpx.Response(404)

    with httpx.Client(transport=httpx.MockTransport(handler)) as github:
        project = import_public_github_repository("https://github.com/owner/demo", github)
    manifest = next(item for item in project["files"] if item["path"] == "project.json")
    paths = {item["path"] for item in project["files"]}
    assert project["name"] == "demo"
    assert project["kind"] == "fpga_prototype"
    assert "node_modules/ignored.v" not in paths
    imported_manifest = json.loads(manifest["content"])
    assert imported_manifest["execution"]["rtl_top"] == "demo"
    assert imported_manifest["physical"]["clock_period_ns"] == 25
    assert imported_manifest["physical"]["timing_effort"] == "balanced"
