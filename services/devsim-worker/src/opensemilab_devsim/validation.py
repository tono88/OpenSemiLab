from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from .models import Experiment
from .solver import simulate


def _metric(result: dict[str, Any], label: str) -> float:
    return next(item["value"] for item in result["metrics"] if item["label"] == label)


def _relative(left: float, right: float) -> float:
    return abs(left - right) / max(abs(right), 1e-30)


def validate(experiment: Experiment, meshes: list[int]) -> dict[str, Any]:
    results = [simulate(experiment, mesh_points=points) for points in meshes]
    finest = results[-1]
    refs = finest["provenance"]["references"]
    built_in_error = _relative(_metric(finest, "Built-in potential"), refs["analytic_builtin_v"])
    width_error = _relative(_metric(finest, "Depletion width"), refs["analytic_depletion_um"])
    coarse_fine = _relative(_metric(results[-2], "Built-in potential"), _metric(finest, "Built-in potential"))
    iv_runs = [next(series for series in result["series"] if series["name"] == "iv")["y"] for result in results[-2:]]
    iv_scale = max((abs(value) for value in iv_runs[-1]), default=1e-30)
    iv_delta = max((abs(a - b) / max(iv_scale, 1e-30) for a, b in zip(*iv_runs)), default=0.0)
    conservation = finest["provenance"]["current_conservation_max"]
    checks = [
        {"id": "builtin", "label": "Built-in potential vs analytic", "value": built_in_error, "limit": 0.05, "passed": built_in_error < 0.05},
        {"id": "depletion", "label": "Depletion width vs analytic", "value": width_error, "limit": 0.10, "passed": width_error < 0.10},
        {"id": "mesh-potential", "label": "Potential mesh convergence", "value": coarse_fine, "limit": 0.03, "passed": coarse_fine < 0.03},
        {"id": "mesh-current", "label": "I-V mesh convergence", "value": iv_delta, "limit": 0.03, "passed": iv_delta < 0.03},
        {"id": "current-conservation", "label": "Terminal current conservation", "value": conservation, "limit": 0.01, "passed": conservation < 0.01},
    ]
    payload = {
        "schema": "opensemilab.reproducibility.v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "experiment": experiment.model_dump(mode="json"),
        "mesh_points": meshes,
        "result": finest,
        "validation": {"passed": all(check["passed"] for check in checks), "checks": checks},
    }
    payload["checksums"] = {
        "experiment_sha256": hashlib.sha256(json.dumps(payload["experiment"], sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
        "result_sha256": hashlib.sha256(json.dumps(payload["result"], sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    payload["bundle_sha256"] = hashlib.sha256(canonical.encode()).hexdigest()
    return {"passed": payload["validation"]["passed"], "checks": checks, "result": finest, "bundle": payload}


def compare(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    left_result, right_result = left["result"], right["result"]
    metric_deltas = {}
    for metric in left_result["metrics"]:
        other = next((item for item in right_result["metrics"] if item["label"] == metric["label"]), None)
        if other:
            metric_deltas[metric["label"]] = _relative(metric["value"], other["value"])
    series_deltas = {}
    for series in left_result["series"]:
        other = next((item for item in right_result["series"] if item["name"] == series["name"]), None)
        if other and len(series["y"]) == len(other["y"]):
            series_deltas[series["name"]] = max((_relative(a, b) for a, b in zip(series["y"], other["y"])), default=0.0)
    return {
        "same_input": left_result["provenance"]["input_sha256"] == right_result["provenance"]["input_sha256"],
        "same_engine": left_result["provenance"]["engine_version"] == right_result["provenance"]["engine_version"],
        "metric_relative_deltas": metric_deltas,
        "series_max_relative_deltas": series_deltas,
    }
