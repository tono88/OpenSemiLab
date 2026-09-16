import importlib.util

from opensemilab_api.engines.base import SimulationEngine
from opensemilab_api.models import EngineCapability, Experiment, SimulationResult


class DevsimEngine(SimulationEngine):
    """Capability boundary for DEVSIM.

    The native solve sequence will be implemented as an isolated worker. Importing
    DEVSIM here only detects an explicitly installed optional dependency.
    """

    def capability(self) -> EngineCapability:
        installed = importlib.util.find_spec("devsim") is not None
        return EngineCapability(
            id="devsim",
            label="DEVSIM drift-diffusion",
            available=False,
            fidelity="professional",
            description=(
                "DEVSIM is installed; the validated OpenSemiLab worker is still pending."
                if installed
                else "Install DEVSIM, then enable the validated OpenSemiLab worker."
            ),
        )

    def run(self, experiment: Experiment) -> SimulationResult:
        raise RuntimeError(
            "The DEVSIM adapter is not executable yet. Use the educational engine or implement the validated M1 worker."
        )
