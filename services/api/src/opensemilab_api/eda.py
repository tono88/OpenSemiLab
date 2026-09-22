from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class PhysicalOptions(BaseModel):
    pdk: str = Field(pattern=r"^(sky130A|gf180mcuD|private:[a-z0-9][a-z0-9-]{2,63})$")
    floorplan_mode: Literal["auto", "manual"] = "auto"
    clock_port: str = Field("clk", pattern=r"^[A-Za-z_][A-Za-z0-9_$]*$")
    clock_period_ns: float = Field(25.0, ge=0.1, le=1000)
    die_width_um: float = Field(120.0, ge=30, le=5000)
    die_height_um: float = Field(120.0, ge=30, le=5000)
    core_utilization_pct: float = Field(40.0, ge=5, le=80)
    timing_effort: Literal["balanced", "aggressive"] = "balanced"
    sdc_content: str | None = Field(None, max_length=100_000)

    @field_validator("sdc_content")
    @classmethod
    def safe_sdc(cls, value: str | None) -> str | None:
        if value and any(token in value.lower() for token in ("[exec", "source ", "open ", "socket ", "package require", "file delete", "file rename")):
            raise ValueError("SDC contains commands that are not allowed in the isolated flow")
        return value


class EdaRunRequest(BaseModel):
    action: Literal["lint", "simulate", "synthesize", "spice", "vhdl", "physical", "formal", "fpga", "xyce", "openems", "xschem", "gds3d", "cace"]
    top: str = Field("top", pattern=r"^[A-Za-z_][A-Za-z0-9_$]*$")
    entry: str | None = None
    physical: PhysicalOptions | None = None
    adapter: dict[str, Any] | None = None
    encodings: dict[str, Literal["utf-8", "base64"]] | None = None
    sources: dict[str, str]

    @model_validator(mode="after")
    def physical_options_required(self):
        if self.action == "physical" and self.physical is None:
            raise ValueError("physical options are required for physical implementation")
        return self

    @field_validator("sources")
    @classmethod
    def source_limits(cls, value: dict[str, str]) -> dict[str, str]:
        if not value:
            raise ValueError("at least one source file is required")
        if sum(len(content.encode()) for content in value.values()) > 3_000_000:
            raise ValueError("source bundle exceeds 3 MB")
        return value
