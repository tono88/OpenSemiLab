import io
import gzip
import json
import tarfile
import zipfile
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from opensemilab_api.github_import import import_public_github_repository, parse_github_repository
from opensemilab_api.main import app
from opensemilab_api.eda import EdaRunRequest
from opensemilab_api.auth import _hash_pw, _issue_token
from opensemilab_api.db import SessionLocal, init_db
from opensemilab_api.models_db import User

client = TestClient(app)


def _seed_qa_user() -> None:
    init_db()
    db = SessionLocal()
    email = "qa@unis.edu.gt"
    user = db.query(User).filter_by(email=email).first()
    if user is None:
        user = User(email=email, name="QA", password_hash=_hash_pw("QaPrueba1234"), is_verified=True)
        db.add(user)
        db.commit()
        db.refresh(user)
    client.headers.update({"Authorization": f"Bearer {_issue_token(user)}"})
    db.close()


_seed_qa_user()


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_email_verification_loop_gates_login():
    import os
    import uuid

    os.environ["OPENSEMILAB_EXPOSE_RESET_TOKEN"] = "1"
    email = f"nuevo-{uuid.uuid4().hex[:8]}@unis.edu.gt"
    reg = client.post(
        "/api/v1/auth/register",
        json={"email": email, "name": "Nuevo", "password": "Secreto123"},
    )
    assert reg.status_code == 201
    assert reg.json()["verify_required"] is True
    assert "token" not in reg.json()
    blocked = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "Secreto123"},
    )
    assert blocked.status_code == 403
    assert "erifica" in blocked.json()["detail"]
    verified = client.get(f"/api/v1/auth/verify?token={reg.json()['dev_token']}")
    assert verified.status_code == 200
    assert "token" in verified.json()
    ok = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "Secreto123"},
    )
    assert ok.status_code == 200


def test_edu_general_accepts_and_rejects():
    from opensemilab_api.auth import is_allowed_email

    for email in (
        "a@harvard.edu",
        "a@unis.edu.gt",
        "a@itesm.edu.mx",
        "a@uca.edu.sv",
        "a@uni.edu.co",
        "  MAYUS@UNI.EDU.MX  ",
    ):
        assert is_allowed_email(email) is True, email
    for email in (
        "a@gmail.com",
        "a@unis.edu.gt.fake.com",
        "a@edu.fake.com",
        "a@universidad.com",
    ):
        assert is_allowed_email(email) is False, email

    bad = client.post(
        "/api/v1/auth/register",
        json={"email": "x@gmail.com", "name": "X", "password": "Secreto123"},
    )
    assert bad.status_code == 403
    assert ".edu" in bad.json()["detail"]


def test_verify_link_logged_when_smtp_fails(monkeypatch, caplog):
    import logging
    import uuid

    import opensemilab_api.auth as auth_mod
    from opensemilab_api.auth import _hash_pw as _h
    from opensemilab_api.db import SessionLocal as SL, init_db as _init
    from opensemilab_api.models_db import User as _User

    monkeypatch.setattr(auth_mod, "send_configured_email", lambda *a, **k: False)
    _init()
    db = SL()
    email = f"smtpfail-{uuid.uuid4().hex[:8]}@uni.edu.mx"
    u = _User(email=email, name="S", password_hash=_h("x" * 16))
    db.add(u)
    db.commit()
    db.refresh(u)
    with caplog.at_level(logging.WARNING, logger="opensemilab.auth"):
        raw, sent = auth_mod._new_verify_token(db, u)
    assert sent is False
    assert raw in "\n".join(caplog.messages)
    db.delete(u)
    db.commit()
    db.close()


def test_login_lockout_escalates():
    email = "bloqueado@unis.edu.gt"
    for _ in range(5):
        r = client.post("/api/v1/auth/login", json={"email": email, "password": "mala"})
        assert r.status_code == 401
    locked = client.post("/api/v1/auth/login", json={"email": email, "password": "mala"})
    assert locked.status_code == 429
    assert "loqueado" in locked.json()["detail"]


def test_cookie_session_works_without_bearer():
    from fastapi.testclient import TestClient as TC

    from opensemilab_api.auth import _hash_pw as _h
    from opensemilab_api.db import SessionLocal as SL
    from opensemilab_api.main import app as _app
    from opensemilab_api.models_db import User as _User

    db = SL()
    cookie = db.query(_User).filter_by(email="galleta@unis.edu.gt").first()
    if cookie is None:
        cookie = _User(email="galleta@unis.edu.gt", name="G", password_hash=_h("Secreto123"), is_verified=True)
        db.add(cookie)
        db.commit()
    db.close()
    c2 = TC(_app)
    r = c2.post("/api/v1/auth/login", json={"email": "galleta@unis.edu.gt", "password": "Secreto123"})
    assert r.status_code == 200
    assert "opensemilab_session" in r.cookies
    me = c2.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "galleta@unis.edu.gt"
    assert c2.post("/api/v1/auth/logout").status_code == 200
    assert c2.get("/api/v1/auth/me").status_code == 401


def test_projects_crud_and_gallery():
    created = client.post("/api/v1/projects", json={"name": "Mi MCU", "data": {"kind": "microcontroller"}})
    assert created.status_code == 201
    pid = created.json()["id"]
    mine = client.get("/api/v1/projects")
    assert [p["id"] for p in mine.json()] == [pid]
    updated = client.put(f"/api/v1/projects/{pid}", json={"name": "Mi MCU v2", "data": {"kind": "microcontroller"}})
    assert updated.status_code == 200
    assert updated.json()["name"] == "Mi MCU v2"
    gallery = client.get("/api/v1/projects/gallery")
    assert pid in [p["id"] for p in gallery.json()]
    assert client.delete(f"/api/v1/projects/{pid}").status_code == 204
    assert client.get("/api/v1/projects").json() == []


def test_events_ingest():
    assert client.post("/api/v1/events", json={"project_id": "x", "tool": "yosys", "action": "synthesize"}).status_code == 202


def test_admin_gates_and_powers():
    from fastapi.testclient import TestClient as TC

    from opensemilab_api.db import SessionLocal as SL
    from opensemilab_api.main import app as _app
    from opensemilab_api.models_db import User as _User

    anon = TC(_app)
    assert anon.get("/api/v1/admin/stats").status_code == 401
    db0 = SL()
    qa0 = db0.query(_User).filter_by(email="qa@unis.edu.gt").first()
    qa0.role = "user"
    db0.commit()
    db0.close()
    assert client.get("/api/v1/admin/stats").status_code == 403
    db = SL()
    qa = db.query(_User).filter_by(email="qa@unis.edu.gt").first()
    qa.role = "admin"
    db.commit()
    db.close()
    stats = client.get("/api/v1/admin/stats")
    assert stats.status_code == 200
    assert stats.json()["events"] >= 1
    users = client.get("/api/v1/admin/users").json()
    assert any(u["email"] == "qa@unis.edu.gt" for u in users)
    other = client.post("/api/v1/projects", json={"name": "Borrable", "data": {}}).json()
    assert client.delete(f"/api/v1/admin/projects/{other['id']}").status_code == 204
    assert client.get("/api/v1/projects").json() == []


def test_smtp_settings_are_admin_only_and_secret_is_not_returned():
    from fastapi.testclient import TestClient as TC

    from opensemilab_api.db import SessionLocal as SL
    from opensemilab_api.main import app as _app
    from opensemilab_api.models_db import SmtpSettings as _SmtpSettings
    from opensemilab_api.models_db import User as _User

    anonymous = TC(_app)
    assert anonymous.get("/api/v1/admin/smtp").status_code == 401

    db = SL()
    qa = db.query(_User).filter_by(email="qa@unis.edu.gt").first()
    qa.role = "admin"
    db.commit()
    client.headers.update({"Authorization": f"Bearer {_issue_token(qa)}"})
    db.close()

    saved = client.put(
        "/api/v1/admin/smtp",
        json={
            "enabled": True,
            "host": "smtp.example.test",
            "port": 465,
            "encryption": "ssl",
            "username": "mailer@example.com",
            "password": "app-secret-123",
            "from_email": "mailer@example.com",
            "from_name": "OpenSemiLab",
        },
    )
    assert saved.status_code == 200
    assert saved.json()["has_password"] is True
    assert "password" not in saved.json()

    db = SL()
    record = db.get(_SmtpSettings, "default")
    assert record.password_encrypted != "app-secret-123"
    db.close()

    with patch("opensemilab_api.admin.send_email") as sender:
        tested = client.post("/api/v1/admin/smtp/test", json={})
    assert tested.status_code == 200
    assert tested.json()["recipient"] == "qa@unis.edu.gt"
    sender.assert_called_once()


def test_user_cannot_touch_others_project():
    from opensemilab_api.auth import _hash_pw as _h, _issue_token as _t
    from opensemilab_api.db import SessionLocal as SL
    from opensemilab_api.models_db import User as _User

    db = SL()
    intruder = db.query(_User).filter_by(email="intruso@unis.edu.gt").first()
    if intruder is None:
        intruder = _User(email="intruso@unis.edu.gt", name="I", password_hash=_h("x" * 16), is_verified=True)
        db.add(intruder)
        db.commit()
        db.refresh(intruder)
    itoken = _t(intruder)
    db.close()
    mine = client.post("/api/v1/projects", json={"name": "Privado", "data": {}}).json()
    r = client.put(f"/api/v1/projects/{mine['id']}", json={"name": "Hack", "data": {}}, headers={"Authorization": f"Bearer {itoken}"})
    assert r.status_code == 404
    assert client.delete(f"/api/v1/projects/{mine['id']}").status_code == 204


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


def test_private_pdk_import_accepts_individual_views(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENSEMILAB_PDK_ROOT", str(tmp_path / "pdks"))
    response = client.post(
        "/api/v1/pdks/import",
        data={
            "display_name": "Individual views", "version": "1.0", "process": "demo",
            "stack": "1P5M", "license_acknowledged": "true",
        },
        files=[("files", ("cells.lib", b"library(test) {}", "application/octet-stream"))],
    )
    assert response.status_code == 201
    pdk = response.json()
    assert pdk["file_count"] == 1
    assert pdk["inventory"]["liberty"] == 1


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
        bundle.writestr("local180/libs.ref/cells7t/techlef/process.tlef", "VERSION 5.8 ;\nLAYER M1\n TYPE ROUTING ;\nEND M1\nEND LIBRARY")
        bundle.writestr("local180/libs.ref/cells7t/lef/cells.lef", "VERSION 5.8 ;\nMACRO INV\nEND INV\nEND LIBRARY")
        bundle.writestr("local180/libs.ref/cells7t/lib/cells.lib", "library(test) {}")
        bundle.writestr("local180/libs.ref/cells7t/gds/cells.gds", "test-layout")
        bundle.writestr("local180/libs.ref/cells7t/klayout/process.lyt", "<technology/>")
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


def test_private_pdk_conversion_requires_exact_stack_and_stays_honest(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENSEMILAB_PDK_ROOT", str(tmp_path / "pdks"))
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as bundle:
        for stack in ("1p5m_1tm_9k", "1p5m_1tm_11k"):
            bundle.writestr(
                f"lef_techfiles/tech/GL150M_{stack}.lef",
                "VERSION 5.8 ;\nLAYER M1\n TYPE ROUTING ;\nEND M1\nEND LIBRARY",
            )
        bundle.writestr("lef/cells.lef", "VERSION 5.8 ;\nMACRO INV\n SITE core ;\nEND INV\nEND LIBRARY")
        bundle.writestr("lib/cells.lib", "library(test) { cell(INV) {} }")
        bundle.writestr("verilog/cells.v", "module INV(input A, output Y); assign Y=~A; endmodule")
        bundle.writestr(
            "commercial/1p5m_1tm_11k/stream.map",
            "D 10:0 10 0 ; METAL1\nD 11:0 11 0 ; VIA1\n",
        )
        bundle.writestr(
            "commercial/1p5m_1tm_11k/lvs.cal",
            "LAYER MAP 10 DATATYPE 0 10\nLAYER METAL1 10\n"
            "LAYER MAP 11 DATATYPE 0 11\nLAYER VIA1 11\nCONNECT METAL1 VIA1\n",
        )
        bundle.writestr(
            "commercial/1p5m_1tm_11k/typical.tluplus",
            gzip.compress(b"CONDUCTOR METAL1 { THICKNESS=0.5 RPSQ=0.1 }\n#### end_ascii_header\n\x00"),
        )
        bundle.writestr("commercial/1p5m_1tm_11k/corner.rules.R", b"#DECRYPT\nsynthetic")
    imported = client.post(
        "/api/v1/pdks/import",
        data={
            "display_name": "Private 150 kit", "version": "1.0", "process": "150 nm",
            "stack": "1P5M_1TM", "license_acknowledged": "true",
        },
        files=[("files", ("kit.zip", archive.getvalue(), "application/zip"))],
    )
    assert imported.status_code == 201
    pdk = imported.json()
    assert pdk["inventory"]["tech_lef"] == 2
    assert pdk["inventory"]["cell_lef"] == 1
    assert pdk["readiness"]["openroad_inputs"] is True
    assert set(pdk["conversion"]["stack_variants"]) == {"1P5M_1TM_9K", "1P5M_1TM_11K"}

    ambiguous = client.post(f"/api/v1/pdks/{pdk['id']}/convert", json={})
    assert ambiguous.status_code == 422
    converted = client.post(
        f"/api/v1/pdks/{pdk['id']}/convert", json={"stack_variant": "1P5M_1TM_11K"}
    )
    assert converted.status_code == 200
    result = converted.json()
    assert result["conversion"]["status"] == "generated_with_blockers"
    assert result["conversion"]["selected_stack"] == "1P5M_1TM_11K"
    assert result["conversion"]["normalized_views"]["tech_lef"] == 1
    assert result["conversion"]["bundle_available"] is True
    assert len(result["conversion"]["bundle_sha256"]) == 64
    assert result["conversion"]["translation"]["status"] == "draft_requires_validation"
    assert result["conversion"]["translation"]["layer_count"] == 2
    assert result["conversion"]["translation"]["rc_corner_count"] == 1
    assert result["conversion"]["translation"]["encrypted_file_count"] == 1
    assert "cell_layout_missing" in result["conversion"]["blockers"]
    assert result["readiness"]["physical"] is False
    assert "generated-adapter" not in json.dumps(result)

    record = tmp_path / "pdks" / pdk["id"] / "content" / "generated-adapter"
    assert (record / "opensemilab-pdk.json").is_file()
    assert len(list(record.rglob("*.lef"))) == 2
    bundle_response = client.get(f"/api/v1/pdks/{pdk['id']}/bundle")
    assert bundle_response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(bundle_response.content)) as compiled:
        names = set(compiled.namelist())
        assert "opensemilab-pdk-adapter/SHA256SUMS" in names
        assert "opensemilab-pdk-adapter/REQUIRED_INPUTS.json" in names
        assert "opensemilab-pdk-adapter/translations/klayout/technology.lyt" in names
        assert "opensemilab-pdk-adapter/translations/openrcx/CALIBRATION_REQUIRED.md" in names
        assert not any("package-" in name or "supplement-" in name for name in names)
        checksums = compiled.read("opensemilab-pdk-adapter/SHA256SUMS").decode()
        assert "conversion-report.json" in checksums

    supplement = io.BytesIO()
    with zipfile.ZipFile(supplement, "w") as bundle:
        bundle.writestr("layout/cells.gds", "private-layout-placeholder")
        bundle.writestr("klayout/process.lyt", "<technology/>")
    extended = client.post(
        f"/api/v1/pdks/{pdk['id']}/files",
        data={"license_acknowledged": "true"},
        files=[("files", ("physical-views.zip", supplement.getvalue(), "application/zip"))],
    )
    assert extended.status_code == 200
    assert extended.json()["conversion"]["status"] == "generated_with_blockers"
    assert extended.json()["conversion"]["selected_stack"] == "1P5M_1TM_11K"
    assert extended.json()["conversion"]["bundle_available"] is True
    assert extended.json()["inventory"]["layout"] == 1
    assert extended.json()["readiness"]["physical"] is False
    assert "platform_config_validation_required" in extended.json()["conversion"]["blockers"]
    assert extended.json()["readiness"]["drc"] is False


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
