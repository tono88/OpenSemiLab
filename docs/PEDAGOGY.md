# Progressive pedagogy

OpenSemiLab teaches the same physical object at increasing resolution.

The Device Lab includes 33 modules and 63 executable guides. A first experiment
asks for a prediction, an initial run, one controlled variation and an exported
observation. Each guide has its own locally saved scientific notebook. Equations,
units, consistency checks and model limitations remain available at every level.
See [device-lab.md](device-lab.md) for the complete catalogue and teaching routes.

| Mode | Primary question | Added depth |
|---|---|---|
| Explore | What changes when I move this control? | Guided presets and immediate plots |
| Learn | Why does it change? | Concepts, equations, units, annotated profiles |
| Design | How do I vary one factor? | Full parameters, five-value sweeps, seeded Monte Carlo and histograms |
| Advanced | How does the model compare with observation? | Measurement import, uncertainties, residuals, regression and local PN TCAD |
| Research | Can another person reproduce it? | Parameter extraction, exact input, provenance and complete exports |

## Teaching sequence: PN junction

1. Build two silicon regions with opposite dopants.
2. Observe carrier diffusion and the depletion region.
3. Relate charge separation to electric field and built-in potential.
4. Apply forward and reverse bias and inspect the I–V curve.
5. Increase doping and explain the change in depletion width.
6. Increase analytic-curve sampling and distinguish drawing resolution from added physics.
7. Open the separate DEVSIM reference on the client; refine its spatial mesh and compare assumptions, convergence and residuals.

## From first observation to characterization

Start with carrier motion, silicon doping, PN barriers, LED light and RC charging.
Move to C–V, BJT regions, MOS transfer curves and CMOS switching. For scientific
work, hold conditions fixed, record units and temperature, compare measurements
with uncertainties, examine residuals and export reproducible data. A qualitative
animation teaches motion; its particle counts and speeds are not solver outputs.
An analytic identity passing a check does not establish agreement with hardware.

The interface should never hide terminology permanently. It introduces terms at the moment they become useful and keeps definitions one interaction away.
