import os

import devsim
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .models import CompareRequest, Experiment, ValidationRequest
from .solver import simulate
from .validation import compare, validate

app = FastAPI(title="OpenSemiLab Local DEVSIM", version=__version__)
origins = [value.strip() for value in os.getenv("OPENSEMILAB_ALLOWED_ORIGINS", "").split(",") if value.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "opensemilab-devsim-local", "version": __version__, "devsim_version": getattr(devsim, "__version__", "2.11.0")}


@app.post("/api/v1/simulations/pn-junction")
def run_simulation(experiment: Experiment) -> dict:
    try:
        return simulate(experiment)
    except RuntimeError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/v1/validation/pn-junction")
def run_validation(request: ValidationRequest) -> dict:
    try:
        return validate(request.experiment, request.mesh_points)
    except RuntimeError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/v1/reproducibility/compare")
def compare_bundles(request: CompareRequest) -> dict:
    try:
        return compare(request.left, request.right)
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=f"Invalid reproducibility bundle: {error}") from error


def run() -> None:
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("OPENSEMILAB_DEVSIM_PORT", "8787")))
