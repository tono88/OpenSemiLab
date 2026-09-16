import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from opensemilab_api import __version__
from opensemilab_api.design import DesignPlan, DesignRequest, DesignTemplate, TEMPLATES, make_plan
from opensemilab_api.engines import ENGINES
from opensemilab_api.models import EngineCapability, Experiment, SimulationResult

app = FastAPI(
    title="OpenSemiLab API",
    version=__version__,
    description="Engine-neutral semiconductor experiment orchestration.",
)
origins = os.getenv("OPENSEMILAB_CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in origins],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


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
