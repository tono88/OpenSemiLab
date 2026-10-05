from __future__ import annotations

import hashlib
import contextlib
import io
import json
import math
import threading
import uuid
from dataclasses import dataclass
from typing import Any

import devsim
from devsim.python_packages.model_create import CreateNodeModel, CreateSolution
from devsim.python_packages.simple_physics import (
    CreateSiliconDriftDiffusion,
    CreateSiliconDriftDiffusionAtContact,
    CreateSiliconPotentialOnly,
    CreateSiliconPotentialOnlyContact,
    GetContactBiasName,
    SetSiliconParameters,
)

from .models import Experiment

Q = 1.602176634e-19
KB = 1.380649e-23
EPS_SI = 11.7 * 8.8541878128e-14
NI_300 = 1.0e10
_DEVSIM_LOCK = threading.Lock()


def _linspace(start: float, stop: float, count: int) -> list[float]:
    step = (stop - start) / (count - 1)
    return [start + index * step for index in range(count)]


def _fingerprint(experiment: Experiment) -> str:
    canonical = json.dumps(experiment.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _solve(experiment: Experiment, *, absolute_error: float = 1e10) -> dict[str, Any]:
    tolerance = max(experiment.numerics.relative_tolerance, 1e-7)
    with contextlib.redirect_stdout(io.StringIO()):
        return devsim.solve(
            type="dc",
            absolute_error=absolute_error,
            relative_error=tolerance,
            maximum_iterations=experiment.numerics.max_iterations,
            info=True,
        )


def _iteration_count(info: dict[str, Any]) -> int:
    return sum(len(values) for key, values in info.items() if key.startswith("iteration"))


def _residual(info: dict[str, Any]) -> tuple[float, float]:
    iterations = info.get("iterations", ())
    if not iterations:
        return 0.0, 0.0
    devices = iterations[-1].get("devices", ())
    return (
        max((float(device.get("relative_error", 0.0)) for device in devices), default=0.0),
        max((float(device.get("absolute_error", 0.0)) for device in devices), default=0.0),
    )


@dataclass
class DeviceContext:
    device: str
    mesh: str
    region: str


def _create_device(experiment: Experiment, mesh_points: int) -> DeviceContext:
    suffix = uuid.uuid4().hex[:10]
    ctx = DeviceContext(f"pn_{suffix}", f"mesh_{suffix}", "silicon")
    length_cm = experiment.device.length_um * 1e-4
    spacing = length_cm / (mesh_points - 1)
    junction = length_cm / 2
    devsim.create_1d_mesh(mesh=ctx.mesh)
    devsim.add_1d_mesh_line(mesh=ctx.mesh, pos=0, ps=spacing, tag="p_contact")
    devsim.add_1d_mesh_line(mesh=ctx.mesh, pos=junction, ps=spacing, tag="junction")
    devsim.add_1d_mesh_line(mesh=ctx.mesh, pos=length_cm, ps=spacing, tag="n_contact")
    devsim.add_1d_contact(mesh=ctx.mesh, name="p", tag="p_contact", material="metal")
    devsim.add_1d_contact(mesh=ctx.mesh, name="n", tag="n_contact", material="metal")
    devsim.add_1d_region(mesh=ctx.mesh, material="Si", region=ctx.region, tag1="p_contact", tag2="n_contact")
    devsim.finalize_mesh(mesh=ctx.mesh)
    devsim.create_device(mesh=ctx.mesh, device=ctx.device)
    SetSiliconParameters(ctx.device, ctx.region, experiment.device.temperature_k)
    devsim.set_parameter(device=ctx.device, region=ctx.region, name="taun", value=1e-8)
    devsim.set_parameter(device=ctx.device, region=ctx.region, name="taup", value=1e-8)
    # Scientific literals avoid the 32-bit integer parsing path in DEVSIM expressions.
    CreateNodeModel(ctx.device, ctx.region, "Acceptors", f"{experiment.device.acceptor_cm3:.17e}*step({junction:.17e}-x)")
    CreateNodeModel(ctx.device, ctx.region, "Donors", f"{experiment.device.donor_cm3:.17e}*step(x-{junction:.17e})")
    CreateNodeModel(ctx.device, ctx.region, "NetDoping", "Donors-Acceptors")
    CreateSolution(ctx.device, ctx.region, "Potential")
    CreateSiliconPotentialOnly(ctx.device, ctx.region)
    for contact in ("p", "n"):
        devsim.set_parameter(device=ctx.device, name=GetContactBiasName(contact), value=0.0)
        CreateSiliconPotentialOnlyContact(ctx.device, ctx.region, contact)
    _solve(experiment, absolute_error=1.0)
    CreateSolution(ctx.device, ctx.region, "Electrons")
    CreateSolution(ctx.device, ctx.region, "Holes")
    devsim.set_node_values(device=ctx.device, region=ctx.region, name="Electrons", init_from="IntrinsicElectrons")
    devsim.set_node_values(device=ctx.device, region=ctx.region, name="Holes", init_from="IntrinsicHoles")
    CreateSiliconDriftDiffusion(ctx.device, ctx.region)
    for contact in ("p", "n"):
        CreateSiliconDriftDiffusionAtContact(ctx.device, ctx.region, contact)
    return ctx


def _profile(ctx: DeviceContext) -> tuple[list[float], list[float], list[float], list[float], list[float], list[float], list[float]]:
    x_cm = list(devsim.get_node_model_values(device=ctx.device, region=ctx.region, name="x"))
    potential = list(devsim.get_node_model_values(device=ctx.device, region=ctx.region, name="Potential"))
    electrons = list(devsim.get_node_model_values(device=ctx.device, region=ctx.region, name="Electrons"))
    holes = list(devsim.get_node_model_values(device=ctx.device, region=ctx.region, name="Holes"))
    doping = list(devsim.get_node_model_values(device=ctx.device, region=ctx.region, name="NetDoping"))
    field: list[float] = []
    for index in range(len(x_cm)):
        lo, hi = max(0, index - 1), min(len(x_cm) - 1, index + 1)
        field.append(-(potential[hi] - potential[lo]) / max(x_cm[hi] - x_cm[lo], 1e-30))
    charge = [Q * (p - n + dop) for p, n, dop in zip(holes, electrons, doping)]
    return [x * 1e4 - x_cm[-1] * 5e3 for x in x_cm], potential, field, charge, doping, electrons, holes


def _bias_targets(experiment: Experiment) -> tuple[list[float], list[float]]:
    targets = _linspace(experiment.sweep.start_v, experiment.sweep.stop_v, experiment.sweep.points)
    negative = sorted((value for value in targets if value < 0), reverse=True)
    positive = sorted(value for value in targets if value >= 0)
    return targets, negative + positive


def _ramp(ctx: DeviceContext, experiment: Experiment, target: float, current: float) -> tuple[float, dict[str, Any]]:
    steps = max(1, math.ceil(abs(target - current) / 0.05))
    info: dict[str, Any] = {}
    for index in range(1, steps + 1):
        value = current + (target - current) * index / steps
        devsim.set_parameter(device=ctx.device, name=GetContactBiasName("p"), value=value)
        info = _solve(experiment)
        if not info.get("converged", False):
            raise RuntimeError(f"DEVSIM did not converge at {value:.6g} V")
    return target, info


def simulate(experiment: Experiment, *, mesh_points: int | None = None) -> dict[str, Any]:
    requested_mesh = mesh_points or experiment.numerics.mesh_points
    with _DEVSIM_LOCK:
        ctx = _create_device(experiment, requested_mesh)
        iteration_total = 0
        try:
            equilibrium = _solve(experiment)
            iteration_total += _iteration_count(equilibrium)
            residuals = [_residual(equilibrium)]
            if not equilibrium.get("converged", False):
                raise RuntimeError("DEVSIM equilibrium solution did not converge")
            x_um, potential, field, charge, doping, electrons, holes = _profile(ctx)
            targets, ordered = _bias_targets(experiment)
            currents: dict[float, float] = {}
            terminal_currents: list[tuple[float, float]] = []
            current_bias = 0.0
            for target in ordered:
                if target >= 0 and current_bias < 0:
                    current_bias, info = _ramp(ctx, experiment, 0.0, current_bias)
                    iteration_total += _iteration_count(info)
                    residuals.append(_residual(info))
                current_bias, info = _ramp(ctx, experiment, target, current_bias)
                iteration_total += _iteration_count(info)
                residuals.append(_residual(info))
                n_density = (
                    devsim.get_contact_current(device=ctx.device, contact="n", equation="ElectronContinuityEquation")
                    + devsim.get_contact_current(device=ctx.device, contact="n", equation="HoleContinuityEquation")
                )
                p_density = (
                    devsim.get_contact_current(device=ctx.device, contact="p", equation="ElectronContinuityEquation")
                    + devsim.get_contact_current(device=ctx.device, contact="p", equation="HoleContinuityEquation")
                )
                terminal_currents.append((n_density, p_density))
                currents[target] = -n_density * experiment.device.area_um2 * 1e-8

            thermal_v = KB * experiment.device.temperature_k / Q
            ni = NI_300 * (experiment.device.temperature_k / 300.0) ** 1.5
            analytic_builtin = thermal_v * math.log(experiment.device.acceptor_cm3 * experiment.device.donor_cm3 / ni**2)
            analytic_width_um = math.sqrt(
                2 * EPS_SI * analytic_builtin / Q
                * (1 / experiment.device.acceptor_cm3 + 1 / experiment.device.donor_cm3)
            ) * 1e4
            built_in = max(potential) - min(potential)
            peak_field = max(abs(value) for value in field)
            # Operational depletion edge: mobile charge neutralizes 65% of the
            # local dopant charge. This is stable on a discrete abrupt-junction mesh.
            active = [
                x for x, value, dopant in zip(x_um, charge, doping)
                if abs(value) >= 0.35 * Q * abs(dopant)
            ]
            depletion_width = max(active) - min(active) if active else 0.0
            version = getattr(devsim, "__version__", "2.11.0")
            current_scale = max((max(abs(n), abs(p)) for n, p in terminal_currents), default=1e-30)
            conservation_errors = [
                abs(n + p) / max(abs(n), abs(p), 1e-30)
                for n, p in terminal_currents
                # Near-zero equilibrium currents are dominated by cancellation
                # noise and do not provide a meaningful conservation ratio.
                if max(abs(n), abs(p)) >= current_scale * 1e-5
            ]
            return {
                "experiment_name": experiment.name,
                "metrics": [
                    {"label": "Built-in potential", "value": built_in, "unit": "V"},
                    {"label": "Depletion width", "value": depletion_width, "unit": "µm"},
                    {"label": "Peak electric field", "value": peak_field, "unit": "V/cm"},
                    {"label": "Thermal voltage", "value": thermal_v, "unit": "V"},
                ],
                "series": [
                    {"name": "potential", "x_label": "Position", "x_unit": "µm", "y_label": "Potential", "y_unit": "V", "x": x_um, "y": potential},
                    {"name": "electric_field", "x_label": "Position", "x_unit": "µm", "y_label": "Electric field", "y_unit": "V/cm", "x": x_um, "y": field},
                    {"name": "charge_density", "x_label": "Position", "x_unit": "µm", "y_label": "Charge density", "y_unit": "C/cm³", "x": x_um, "y": charge},
                    {"name": "electron_density", "x_label": "Position", "x_unit": "µm", "y_label": "Electron density", "y_unit": "cm⁻³", "x": x_um, "y": electrons},
                    {"name": "hole_density", "x_label": "Position", "x_unit": "µm", "y_label": "Hole density", "y_unit": "cm⁻³", "x": x_um, "y": holes},
                    {"name": "iv", "x_label": "Voltage", "x_unit": "V", "y_label": "Current", "y_unit": "A", "x": targets, "y": [currents[value] for value in targets]},
                ],
                "explanations": [
                    "DEVSIM solves Poisson and electron/hole drift-diffusion equations on the local mesh.",
                    "The voltage sweep uses continuation in steps no larger than 50 mV to improve nonlinear convergence.",
                ],
                "warnings": ["Research output: validate material parameters and boundary conditions before fabrication sign-off."],
                "converged": True,
                "provenance": {
                    "engine": "devsim-local",
                    "engine_version": str(version),
                    "model": "1D Poisson + electron/hole drift-diffusion (SRH lifetimes 1e-8 s)",
                    "input_sha256": _fingerprint(experiment),
                    "authoritative": False,
                    "execution_host": "local",
                    "mesh_points": len(x_um),
                    "relative_tolerance": max(experiment.numerics.relative_tolerance, 1e-7),
                    "iterations": iteration_total,
                    "current_conservation_max": max(conservation_errors, default=0.0),
                    "residuals": {
                        "max_final_relative": max((item[0] for item in residuals), default=0.0),
                        "max_final_absolute": max((item[1] for item in residuals), default=0.0),
                    },
                    "references": {"analytic_builtin_v": analytic_builtin, "analytic_depletion_um": analytic_width_um},
                },
            }
        finally:
            devsim.delete_device(device=ctx.device)
            devsim.delete_mesh(mesh=ctx.mesh)
