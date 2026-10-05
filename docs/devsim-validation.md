# DEVSIM PN-junction validation baseline

This document defines the scientific baseline implemented by the local OpenSemiLab DEVSIM companion. Results remain `authoritative: false`: passing these checks establishes numerical consistency for this example, not fabrication sign-off or process calibration.

## Canonical reference and adaptation

The implementation follows DEVSIM's canonical 1D diode sequence from [`examples/diode/diode_1d.py`](https://github.com/devsim/devsim/blob/43b41ca845184c47e22b72d144db7e7db8509377/examples/diode/diode_1d.py) and its shared setup in [`diode_common.py`](https://github.com/devsim/devsim/blob/43b41ca845184c47e22b72d144db7e7db8509377/examples/diode/diode_common.py): create an abrupt silicon junction, solve equilibrium Poisson, initialize carrier densities from the intrinsic solution, add electron and hole continuity equations, and use DC continuation for the applied bias. OpenSemiLab parameterizes geometry, doping, temperature, mesh, tolerance, iteration limit, area, and sweep instead of retaining the canonical example's fixed values.

The regression test compares the normalized solution against both analytic abrupt-junction limits and canonical DEVSIM invariants: a converged coupled solution, equal-and-opposite terminal currents, complete carrier/potential/field output, and stable results across mesh refinement.

## Baseline

| Parameter | Value | Unit |
|---|---:|---|
| Temperature | 300 | K |
| Acceptor / donor density | `1.0e16` / `1.0e16` | cm⁻³ |
| Device length | 2.0 | µm |
| Junction area | 100 | µm² |
| Bias sweep | −0.5 to +0.7 (73 points) | V |
| Meshes | 51, 101, 201 | nodes |
| Effective relative tolerance | `max(requested, 1.0e-7)` | dimensionless |
| SRH electron / hole lifetime | `1.0e-8` / `1.0e-8` | s |

## Error measures and thresholds

| Check | Measure | Pass limit |
|---|---|---:|
| Built-in potential | `abs(DEVSIM − analytic) / abs(analytic)` | < 5% |
| Depletion width | same relative error; the numerical edge is where uncompensated dopant charge reaches 35% | < 10% |
| Potential mesh convergence | relative difference between the two finest meshes | < 3% |
| I–V mesh convergence | maximum absolute pointwise difference divided by finest-mesh full-scale current | < 3% |
| Current conservation | `abs(Ip + In) / max(abs(Ip), abs(In))`; near-zero values below `1.0e-5` of sweep full scale are excluded | < 1% |

The 300 K baseline currently measures approximately 0.715 V built-in potential versus 0.714 V analytically. The automated 51/101/201-node run passes all five limits and stores the exact measured values in the reproducibility bundle.

## Assumptions and limitations

- Abrupt, uniformly doped, one-dimensional silicon junction with ideal ohmic contacts.
- DEVSIM's bundled silicon mobility and material parameters plus fixed SRH lifetimes; no process-specific calibration.
- No band-gap narrowing, high-field mobility calibration, avalanche breakdown, quantum corrections, self-heating, contact resistance, or multidimensional edge effects.
- The analytic comparison uses `ni = 1.0e10 cm⁻³` at 300 K with a teaching-oriented temperature scaling, so it is a bounded cross-check rather than an independent process model.
- The reported depletion width uses an explicit operational charge threshold so that the measure is reproducible on a discrete mesh.
- A passing bundle demonstrates reproducibility for the encoded inputs and engine version only. It is not a claim of agreement with measured silicon hardware.
