from fastapi.testclient import TestClient

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
    assert {"microcontroller", "sensor_interface", "analog_block", "rf_frontend"} <= kinds


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


def test_specialized_eda_actions_share_the_validated_contract():
    for action in ("formal", "fpga", "xyce", "openems", "xschem", "gds3d", "cace"):
        request = EdaRunRequest(action=action, top="top", sources={"input.txt": "bounded"}, adapter={"depth": 20})
        assert request.action == action
