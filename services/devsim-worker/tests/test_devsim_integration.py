from fastapi.testclient import TestClient

from opensemilab_devsim.app import app
from opensemilab_devsim.models import Experiment
from opensemilab_devsim.solver import simulate
from opensemilab_devsim.validation import compare


def compact_experiment(mesh_points: int = 51) -> Experiment:
    return Experiment(
        sweep={"start_v": -0.1, "stop_v": 0.1, "points": 3},
        numerics={"mesh_points": mesh_points, "relative_tolerance": 1e-7, "max_iterations": 80},
    )


def test_health_reports_devsim() -> None:
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json()["service"] == "opensemilab-devsim-local"


def test_real_devsim_pn_solution_and_provenance() -> None:
    result = simulate(compact_experiment())
    metrics = {item["label"]: item["value"] for item in result["metrics"]}
    assert result["converged"] is True
    assert abs(metrics["Built-in potential"] - 0.7143) / 0.7143 < 0.05
    assert result["provenance"]["execution_host"] == "local"
    assert result["provenance"]["mesh_points"] == 51
    assert result["provenance"]["current_conservation_max"] < 0.01
    assert result["provenance"]["residuals"]["max_final_relative"] < 1e-7
    assert {"potential", "electric_field", "charge_density", "electron_density", "hole_density", "iv"} <= {series["name"] for series in result["series"]}
    assert len(next(series for series in result["series"] if series["name"] == "iv")["y"]) == 3


def test_reproducibility_comparison() -> None:
    result = simulate(compact_experiment())
    bundle = {"result": result}
    comparison = compare(bundle, bundle)
    assert comparison["same_input"] is True
    assert comparison["same_engine"] is True
    assert max(comparison["metric_relative_deltas"].values()) == 0
    assert max(comparison["series_max_relative_deltas"].values()) == 0
