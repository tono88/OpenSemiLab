from fastapi.testclient import TestClient

from opensemilab_api.main import app

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
