from typing import Literal

from pydantic import BaseModel, Field, field_validator


class EdaRunRequest(BaseModel):
    action: Literal["lint", "simulate", "synthesize", "spice"]
    top: str = Field("top", pattern=r"^[A-Za-z_][A-Za-z0-9_$]*$")
    entry: str | None = None
    sources: dict[str, str]

    @field_validator("sources")
    @classmethod
    def source_limits(cls, value: dict[str, str]) -> dict[str, str]:
        if not value:
            raise ValueError("at least one source file is required")
        if sum(len(content.encode()) for content in value.values()) > 256_000:
            raise ValueError("source bundle exceeds 256 KB")
        return value
