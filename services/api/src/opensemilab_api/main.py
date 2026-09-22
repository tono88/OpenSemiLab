import os

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from opensemilab_api import __version__
from opensemilab_api.design import DesignPlan, DesignRequest, DesignTemplate, TEMPLATES, make_plan
from opensemilab_api.eda import EdaRunRequest
from opensemilab_api.engines import ENGINES
from opensemilab_api.github_import import import_public_github_repository
from opensemilab_api.models import EngineCapability, Experiment, SimulationResult
from opensemilab_api.pdk_registry import delete_private_pdk, import_private_pdk, list_private_pdks
from pydantic import BaseModel, Field

app = FastAPI(
    title="OpenSemiLab API",
    version=__version__,
    description="Engine-neutral semiconductor experiment orchestration.",
)
origins = os.getenv("OPENSEMILAB_CORS_ORIGINS", "http://localhost:5173").split(",")
eda_worker_url = os.getenv("OPENSEMILAB_EDA_WORKER_URL", "http://localhost:9000").rstrip("/")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in origins],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)


class GithubImportRequest(BaseModel):
    url: str = Field(min_length=20, max_length=300)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@app.get("/api/v1/engines", response_model=list[EngineCapability])
def list_engines() -> list[EngineCapability]:
    return [engine.capability() for engine in ENGINES.values()]


@app.get("/api/v1/design/templates", response_model=list[DesignTemplate])
def list_design_templates() -> list[DesignTemplate]:
    return TEMPLATES


@app.post("/api/v1/design/plan", response_model=DesignPlan)
def create_design_plan(project: DesignRequest) -> DesignPlan:
    return make_plan(project)


@app.post("/api/v1/design/import-github")
def import_github_project(request: GithubImportRequest) -> dict:
    try:
        return import_public_github_repository(request.url)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/api/v1/pdks")
def list_pdks() -> list[dict]:
    return list_private_pdks()


@app.post("/api/v1/pdks/import", status_code=201)
async def import_pdk(
    files: list[UploadFile] = File(...),
    display_name: str = Form(...),
    version: str = Form(...),
    process: str = Form(...),
    stack: str = Form(...),
    license_acknowledged: bool = Form(False),
) -> dict:
    try:
        return await import_private_pdk(
            files, display_name, version, process, stack, license_acknowledged
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.delete("/api/v1/pdks/{pdk_id}", status_code=204)
def delete_pdk(pdk_id: str) -> None:
    try:
        delete_private_pdk(pdk_id)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail="Private PDK was not found") from error


@app.get("/api/v1/eda/capabilities")
def eda_capabilities() -> dict:
    try:
        response = httpx.get(f"{eda_worker_url}/health", timeout=5)
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise HTTPException(status_code=503, detail=f"IIC-OSIC worker unavailable: {error}") from error


@app.post("/api/v1/eda/run")
def run_eda_action(request: EdaRunRequest) -> dict:
    try:
        response = httpx.post(f"{eda_worker_url}/run", json=request.model_dump(), timeout=100)
        if response.status_code >= 400:
            detail = response.json().get("error", response.text)
            raise HTTPException(status_code=response.status_code, detail=detail)
        return response.json()
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError) as error:
        raise HTTPException(status_code=503, detail=f"IIC-OSIC worker unavailable: {error}") from error


@app.post("/api/v1/eda/jobs", status_code=202)
def start_eda_job(request: EdaRunRequest) -> dict:
    if request.action != "physical":
        raise HTTPException(status_code=422, detail="Only physical implementation uses asynchronous jobs")
    try:
        response = httpx.post(f"{eda_worker_url}/jobs", json=request.model_dump(), timeout=10)
        if response.status_code >= 400:
            detail = response.json().get("error", response.text)
            raise HTTPException(status_code=response.status_code, detail=detail)
        return response.json()
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError) as error:
        raise HTTPException(status_code=503, detail=f"IIC-OSIC worker unavailable: {error}") from error


@app.get("/api/v1/eda/jobs/{job_id}")
def get_eda_job(job_id: str) -> dict:
    if not job_id.isalnum() or len(job_id) > 32:
        raise HTTPException(status_code=422, detail="Invalid job identifier")
    try:
        response = httpx.get(f"{eda_worker_url}/jobs/{job_id}", timeout=120)
        if response.status_code >= 400:
            detail = response.json().get("error", response.text)
            raise HTTPException(status_code=response.status_code, detail=detail)
        return response.json()
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError) as error:
        raise HTTPException(status_code=503, detail=f"IIC-OSIC worker unavailable: {error}") from error


@app.post("/api/v1/eda/jobs/{job_id}/cancel", status_code=202)
def cancel_eda_job(job_id: str) -> dict:
    if not job_id.isalnum() or len(job_id) > 32:
        raise HTTPException(status_code=422, detail="Invalid job identifier")
    try:
        response = httpx.post(f"{eda_worker_url}/jobs/{job_id}/cancel", timeout=15)
        if response.status_code >= 400:
            detail = response.json().get("error", response.text)
            raise HTTPException(status_code=response.status_code, detail=detail)
        return response.json()
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError) as error:
        raise HTTPException(status_code=503, detail=f"IIC-OSIC worker unavailable: {error}") from error


@app.post("/api/v1/simulations/pn-junction", response_model=SimulationResult)
def simulate_pn_junction(experiment: Experiment) -> SimulationResult:
    engine = ENGINES[experiment.engine.value]
    capability = engine.capability()
    if not capability.available:
        raise HTTPException(status_code=409, detail=capability.description)
    try:
        return engine.run(experiment)
    except RuntimeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
