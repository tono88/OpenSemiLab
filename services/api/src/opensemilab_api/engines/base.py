from abc import ABC, abstractmethod

from opensemilab_api.models import EngineCapability, Experiment, SimulationResult


class SimulationEngine(ABC):
    @abstractmethod
    def capability(self) -> EngineCapability: ...

    @abstractmethod
    def run(self, experiment: Experiment) -> SimulationResult: ...
