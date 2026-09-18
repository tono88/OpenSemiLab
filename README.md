# OpenSemiLab

**An open, progressive semiconductor laboratory for classrooms, universities, and research.**

OpenSemiLab presents one coherent workflow on top of open scientific engines. A learner can explore a PN junction visually; an advanced user can inspect the same experiment's geometry, mesh, equations, solver controls, raw data, and provenance.

> Status: foundation release. The PN-junction vertical slice is usable end to end with a deterministic educational solver. A DEVSIM adapter boundary is included for the next integration step.

The Design Studio executes **real RTL lint, simulation, synthesis, batch SPICE simulation, and asynchronous RTL-to-GDSII implementation** inside an isolated IIC-OSIC-TOOLS worker. Projects persist in the browser as multi-file workspaces and can be exported or imported. RF/EM and mixed-signal co-simulation remain staged integrations and are visibly marked as such.

## Why this project

Open-source EDA and multiphysics tools are powerful, but they expose different interfaces, data formats, and assumptions. OpenSemiLab does not replace those engines. It creates a common project model, progressive interface, orchestration API, and reproducible result format around them.

### Progressive depth

| Mode | Audience | What is visible |
|---|---|---|
| Explore | Secondary school | Physical controls, visual intuition, guided language |
| Learn | Introductory university | Concepts, units, bands, fields, carriers, I–V curves |
| Design | Engineering | Geometry, materials, contacts, doping, sweeps |
| Advanced | Graduate/professional | Mesh, models, equations, tolerances, convergence |
| Research | Researchers | Raw data, scripts, provenance, export, reproducibility |

## Current vertical slice

- Enter a dedicated **Design Studio** for complete IC and system projects.
- Create a tool-aware design plan for microcontrollers/SoCs, smart sensor interfaces, analog blocks, RF front-ends, standard cells/IP, and FPGA prototypes.
- Select SKY130, GF180MCU, IHP SG13G2, or IHP SG13CMOS5L and generate a reproducible staged manifest.
- Map each stage to relevant IIC-OSIC-TOOLS engines while clearly distinguishing connected and pending adapters.
- Edit SystemVerilog in the browser and run Verible/Verilator lint, Icarus Verilog simulation, and Yosys synthesis in IIC-OSIC-TOOLS.
- Inspect automatically captured VCD waveforms with signal selection, zoom, and time-window navigation.
- Simulate VHDL-2008 projects with GHDL and capture their VCD output through the same portable result contract.
- Download the synthesized Yosys JSON netlist and inspect complete console output.
- Plot normalized ngspice `.print` results for DC, transient, AC, and noise analyses when those vectors are present in the testbench.
- Run LibreLane Classic asynchronously for SKY130/GF180, explore real DEF placement, density, 2D routing and an interactive exploded 3D layer view, review timing/area/DRC evidence in the sign-off center, and export bounded final GDSII, DEF, LEF, netlist, timing, metrics, log, and JSON report artifacts.
- Keep a bounded local execution history and compare implementation and simulation results.
- Navigate active projects through a compact five-stage vertical wizard, with an explicit IIC-OSIC integration matrix.
- Replay numeric simulation traces as animations, zoom them, and pan horizontally by dragging or using the window control.
- Create and configure a 1D silicon PN junction.
- Change doping, length, temperature, area, bias range, and mesh density.
- Run a deterministic drift-diffusion-inspired educational approximation.
- Inspect electrostatic potential, electric field, charge density, and I–V response.
- Run reproducible educational parameter corners and a 20-sample Monte Carlo study with mean and min–max envelopes.
- Switch between five depth modes without changing the underlying experiment.
- Query engine capabilities and export a self-describing simulation result.
- Select `devsim` explicitly; the API returns a clear capability error until the optional engine is installed.

## Architecture

```mermaid
flowchart TD
    UI["Progressive web interface"] --> API["FastAPI orchestration API"]
    API --> MODEL["Shared experiment contract"]
    MODEL --> EDU["Educational solver"]
    MODEL --> DEV["DEVSIM adapter"]
    MODEL --> FUTURE["MOOSE / FEniCSx / EDA adapters"]
    EDU --> RESULT["Common result + provenance"]
    DEV --> RESULT
    FUTURE --> RESULT
```

The engine boundary is deliberate: copyleft tools can run as separate processes or services while OpenSemiLab keeps a stable, engine-neutral data contract. See [docs/LICENSING.md](docs/LICENSING.md).

### IIC-OSIC integration scope

IIC-OSIC-TOOLS is a broad distribution rather than one engine. OpenSemiLab reports each relevant tool as one of three levels instead of claiming that every installed executable is connected:

| Level | Current tools | Meaning |
|---|---|---|
| Direct | Verible/Verilator, Icarus/VVP, GHDL, Yosys, ngspice, LibreLane, SymbiYosys, nextpnr, Xyce, openEMS, Xschem, GDS3D, CACE | Invoked by a bounded worker workflow with portable results and artifacts. |
| Orchestrated | OpenROAD, OpenSTA, KLayout, Magic, Netgen | Invoked as part of the LibreLane physical flow. |
| Browser-native companion | GTKWave replacement, DEF/GDS physical explorer | Waveforms and physical layers are rendered interactively without exposing a remote desktop. |

GUI editors, Python libraries, PDK managers and highly specialized utilities remain available in the underlying image but are not mislabeled as web integrations.

The specialized adapter cards infer their entry point from project files and remain disabled until a compatible input exists:

| Workflow | Accepted project input | Portable result |
|---|---|---|
| SymbiYosys | RTL plus optional `.sby` | proof logs, traces, generated bounded config |
| nextpnr iCE40 | RTL plus optional `.pcf` | synthesized JSON and routed `.asc` |
| Xyce | `.cir` / `.spice` | logs, raw tables, normalized animated plots |
| openEMS | solver `.xml` | field, CSV, VTK and Touchstone files |
| Xschem | `.sch` with project symbols/models | headless SPICE netlist |
| CACE | a file named `cace*.yaml` or `datasheet*.yaml/json` | characterization reports, tables and plots |
| GDS3D | GDSII from the latest LibreLane run | bounded native import validation; interactive layers remain in the browser |

## Quick start

### Docker Compose

```bash
docker compose up --build
```

The first build downloads the IIC-OSIC-TOOLS image, which is substantially larger than the web/API images and can take considerable time. Later starts reuse Docker's local cache.

Open <http://localhost:5173>. The API documentation is at <http://localhost:8000/docs>.

### Local development

Requirements: Node.js 20+, Python 3.11+.

```bash
# terminal 1
cd services/api
python -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
uvicorn opensemilab_api.main:app --reload

# terminal 2
cd apps/web
npm install
npm run dev
```

### Tests

```bash
cd services/eda-worker && python -m unittest discover -s tests -v
cd services/api && pytest
cd apps/web && npm run build
```

## Repository map

```text
apps/web/             Progressive React interface
services/api/         FastAPI orchestration and simulation adapters
services/eda-worker/  Constrained IIC-OSIC-TOOLS execution bridge
docs/                 Architecture, pedagogy, licensing, roadmap
examples/             Versioned experiment examples
.github/workflows/    CI for API tests and web builds
```

## Scientific scope and honesty

The built-in solver is intentionally labeled **educational**. It produces transparent, deterministic approximations useful for teaching and UI development; it is not a TCAD sign-off engine. Professional claims must come from a validated external engine, recorded mesh/model settings, convergence evidence, and comparison against reference measurements or benchmarks.

## Roadmap

1. Add live per-stage LibreLane progress and exact polygon rendering from GDSII.
2. Extend nextpnr from iCE40 ASC output to board-specific bitstream packing/programming profiles.
3. Normalize Xyce/CACE/openEMS numeric outputs into the animated chart schema and add curated Xschem round-trip templates.
4. Execute a validated DEVSIM diode experiment and normalize its output.
5. Add optional server-side project storage and Git synchronization while retaining local JSON portability.
6. Add MOS capacitor and MOSFET experiment templates.
7. Integrate Gmsh, VTK, and electro-thermal adapters.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Scientific contributions should include units, assumptions, references, validation evidence, and a reproducible example.

## License

OpenSemiLab's original code is licensed under the [Apache License 2.0](LICENSE). External engines and PDKs retain their own licenses and are not redistributed by this repository unless explicitly stated.
