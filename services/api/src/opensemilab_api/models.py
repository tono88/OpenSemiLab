from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class EngineName(StrEnum):
    EDUCATIONAL = "educational"
    DEVSIM = "devsim"


class DeviceSpec(BaseModel):
    kind: Literal["pn_junction_1d"] = "pn_junction_1d"
    material: Literal["silicon"] = "silicon"
    length_um: float = Field(2.0, gt=0, le=100)
    area_um2: float = Field(100.0, gt=0, le=1e8)
    acceptor_cm3: float = Field(1e16, ge=1e12, le=1e20)
    donor_cm3: float = Field(1e16, ge=1e12, le=1e20)
    temperature_k: float = Field(300.0, ge=150, le=600)


class SweepSpec(BaseModel):
    start_v: float = Field(-1.0, ge=-20, le=20)
    stop_v: float = Field(0.8, ge=-20, le=20)
    points: int = Field(73, ge=2, le=1001)

    @model_validator(mode="after")
    def ascending(self):
        if self.stop_v <= self.start_v:
            raise ValueError("stop_v must be greater than start_v")
        return self


class NumericsSpec(BaseModel):
    mesh_points: int = Field(201, ge=21, le=5001)
    relative_tolerance: float = Field(1e-8, gt=0, le=1e-2)
    max_iterations: int = Field(80, ge=1, le=10000)


class Experiment(BaseModel):
    name: str = Field("Silicon PN junction", min_length=1, max_length=120)
    engine: EngineName = EngineName.EDUCATIONAL
    device: DeviceSpec = Field(default_factory=DeviceSpec)
    sweep: SweepSpec = Field(default_factory=SweepSpec)
    numerics: NumericsSpec = Field(default_factory=NumericsSpec)


class Series(BaseModel):
    name: str
    x_label: str
    x_unit: str
    y_label: str
    y_unit: str
    x: list[float]
    y: list[float]


class Metric(BaseModel):
    label: str
    value: float
    unit: str


class Provenance(BaseModel):
    engine: str
    engine_version: str
    model: str
    input_sha256: str
    authoritative: bool


class SimulationResult(BaseModel):
    experiment_name: str
    metrics: list[Metric]
    series: list[Series]
    explanations: list[str]
    warnings: list[str]
    converged: bool
    provenance: Provenance


class EngineCapability(BaseModel):
    id: str
    label: str
    available: bool
    fidelity: Literal["educational", "professional"]
    description: str
