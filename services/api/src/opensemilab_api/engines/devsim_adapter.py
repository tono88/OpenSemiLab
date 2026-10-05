from opensemilab_api.engines.base import SimulationEngine
from opensemilab_api.models import EngineCapability, Experiment, SimulationResult


class DevsimEngine(SimulationEngine):
    """Server boundary for the browser-connected local DEVSIM companion."""

    def capability(self) -> EngineCapability:
        return EngineCapability(
            id="devsim",
            label="DEVSIM drift-diffusion",
            available=False,
            fidelity="professional",
            description="DEVSIM runs in the user's local companion at 127.0.0.1:8787, not on the shared API server.",
        )

    def run(self, experiment: Experiment) -> SimulationResult:
        raise RuntimeError(
            "DEVSIM must be called through the local companion at 127.0.0.1:8787."
        )
