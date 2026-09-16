import hashlib
import json
import math

from opensemilab_api import __version__
from opensemilab_api.engines.base import SimulationEngine
from opensemilab_api.models import (
    EngineCapability,
    Experiment,
    Metric,
    Provenance,
    Series,
    SimulationResult,
)

Q = 1.602176634e-19
KB = 1.380649e-23
EPS0 = 8.8541878128e-14  # F/cm
EPS_SI = 11.7 * EPS0
NI_300 = 1.0e10  # teaching approximation, cm^-3


def _linspace(start: float, stop: float, count: int) -> list[float]:
    step = (stop - start) / (count - 1)
    return [start + index * step for index in range(count)]


class EducationalPNEngine(SimulationEngine):
    def capability(self) -> EngineCapability:
        return EngineCapability(
            id="educational",
            label="Educational PN approximation",
            available=True,
            fidelity="educational",
            description="Transparent analytic approximation for teaching and interface development.",
        )

    def run(self, experiment: Experiment) -> SimulationResult:
        device = experiment.device
        thermal_v = KB * device.temperature_k / Q
        ni = NI_300 * (device.temperature_k / 300.0) ** 1.5
        built_in_v = thermal_v * math.log(device.acceptor_cm3 * device.donor_cm3 / ni**2)
        depletion_cm = math.sqrt(
            2 * EPS_SI * built_in_v / Q
            * (1 / device.acceptor_cm3 + 1 / device.donor_cm3)
        )
        depletion_um = depletion_cm * 1e4
        peak_field = 2 * built_in_v / max(depletion_cm, 1e-30)

        x_um = _linspace(-device.length_um / 2, device.length_um / 2, experiment.numerics.mesh_points)
        half_width = max(depletion_um / 2, device.length_um / experiment.numerics.mesh_points)
        potential: list[float] = []
        field: list[float] = []
        charge: list[float] = []
        for x in x_um:
            normalized = max(-1.0, min(1.0, x / half_width))
            potential.append(built_in_v * (normalized + 1) / 2)
            inside = abs(normalized) < 1
            field.append(-peak_field * (1 - abs(normalized)) if inside else 0.0)
            dopant = -device.acceptor_cm3 if x < 0 else device.donor_cm3
            charge.append(Q * dopant if inside else 0.0)

        voltages = _linspace(experiment.sweep.start_v, experiment.sweep.stop_v, experiment.sweep.points)
        area_cm2 = device.area_um2 * 1e-8
        # Representative teaching lifetime/diffusivity values; intentionally not a calibrated process model.
        diffusion_n, diffusion_p = 35.0, 12.0
        lifetime_n = lifetime_p = 1e-6
        length_n = math.sqrt(diffusion_n * lifetime_n)
        length_p = math.sqrt(diffusion_p * lifetime_p)
        saturation_a = Q * area_cm2 * ni**2 * (
            diffusion_n / (length_n * device.acceptor_cm3)
            + diffusion_p / (length_p * device.donor_cm3)
        )
        currents = [saturation_a * math.expm1(min(v / thermal_v, 40.0)) for v in voltages]

        canonical = json.dumps(experiment.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
        return SimulationResult(
            experiment_name=experiment.name,
            metrics=[
                Metric(label="Built-in potential", value=built_in_v, unit="V"),
                Metric(label="Depletion width", value=depletion_um, unit="µm"),
                Metric(label="Peak electric field", value=peak_field, unit="V/cm"),
                Metric(label="Thermal voltage", value=thermal_v, unit="V"),
            ],
            series=[
                Series(name="potential", x_label="Position", x_unit="µm", y_label="Potential", y_unit="V", x=x_um, y=potential),
                Series(name="electric_field", x_label="Position", x_unit="µm", y_label="Electric field", y_unit="V/cm", x=x_um, y=field),
                Series(name="charge_density", x_label="Position", x_unit="µm", y_label="Charge density", y_unit="C/cm³", x=x_um, y=charge),
                Series(name="iv", x_label="Voltage", x_unit="V", y_label="Current", y_unit="A", x=voltages, y=currents),
            ],
            explanations=[
                "Higher doping narrows the depletion region because less distance is needed to expose balancing fixed charge.",
                "Forward bias lowers the junction barrier, producing the exponential rise in the ideal-diode approximation.",
            ],
            warnings=[
                "Educational approximation: this result is not suitable for fabrication sign-off.",
                "The model omits recombination in the depletion region, series resistance, breakdown, and process-specific mobility.",
            ],
            converged=True,
            provenance=Provenance(
                engine="educational",
                engine_version=__version__,
                model="1D depletion approximation + ideal diode equation",
                input_sha256=fingerprint,
                authoritative=False,
            ),
        )
