from typing import Literal

from pydantic import BaseModel, Field, model_validator


class DeviceSpec(BaseModel):
    kind: Literal["pn_junction_1d"] = "pn_junction_1d"
    material: Literal["silicon"] = "silicon"
    length_um: float = Field(2.0, gt=0, le=100)
    area_um2: float = Field(100.0, gt=0, le=1e8)
    acceptor_cm3: float = Field(1e16, ge=1e12, le=1e20)
    donor_cm3: float = Field(1e16, ge=1e12, le=1e20)
    temperature_k: float = Field(300.0, ge=150, le=600)


class SweepSpec(BaseModel):
    start_v: float = Field(-0.5, ge=-20, le=20)
    stop_v: float = Field(0.7, ge=-20, le=20)
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
    engine: Literal["devsim"] = "devsim"
    device: DeviceSpec = Field(default_factory=DeviceSpec)
    sweep: SweepSpec = Field(default_factory=SweepSpec)
    numerics: NumericsSpec = Field(default_factory=NumericsSpec)


class ValidationRequest(BaseModel):
    experiment: Experiment
    mesh_points: list[int] = Field(default_factory=lambda: [51, 101, 201], min_length=3, max_length=5)

    @model_validator(mode="after")
    def ordered_meshes(self):
        if self.mesh_points != sorted(set(self.mesh_points)) or any(n < 21 or n > 1001 for n in self.mesh_points):
            raise ValueError("mesh_points must be unique, ascending values between 21 and 1001")
        return self


class CompareRequest(BaseModel):
    left: dict
    right: dict
