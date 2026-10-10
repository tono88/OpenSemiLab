# Architecture

## Design principles

1. **One experiment, multiple depths.** Modes reveal additional controls; they do not fork the scientific model.
2. **Engine-neutral contracts.** UI and stored projects depend on OpenSemiLab schemas, not a solver's native file format.
3. **Explicit provenance.** Every result identifies engine, version, model, assumptions, units, warnings, and input fingerprint.
4. **Isolated execution.** Native engines will run in constrained workers with time, CPU, memory, and output limits.
5. **Progressive validation.** Educational approximations are labeled; professional workflows require convergence and benchmark evidence.

## Components

### Web application

The React application owns progressive disclosure, educational narrative, experiment editing, and visualization. It does not calculate authoritative scientific results.

The interface has two first-class workspaces:

- **Design Studio** starts from an engineering outcome (SoC, sensor interface, analog/RF block, reusable IP, or FPGA prototype), then builds a staged toolchain and reproducible manifest.
- **Device Lab** starts from semiconductor physics and fabrication, with 33 analytic/compact modules and 63 guides. A dedicated browser Worker calculates curves and seeded studies; Canvas renders bounded conceptual carrier animations. Both run on the client without simulation API calls. The laboratory is loaded lazily when opened.

Device Lab owns a typed catalogue, parameter validation, model implementations,
measurement import/regression, local notebooks and CSV/SVG/JSON export. Every
calculation keeps its normalized executed input. Draft inputs do not relabel
previous results. Device changes terminate the active Worker and use request
IDs to ignore stale responses. Animation suspends its frame scheduling outside
the viewport and in hidden tabs. See [device-lab.md](device-lab.md).

Design Studio intentionally maps outcomes to tools instead of reproducing the desktop menus of IIC-OSIC-TOOLS. Native tools remain behind adapters and isolated workers.

### Orchestration API

FastAPI validates experiment contracts, discovers engine capabilities, selects adapters, normalizes output, and attaches provenance.

Heavy RTL→GDSII jobs use the single EDA worker's durable FIFO queue. Admission
checks cgroup-normalized CPU, host load, memory headroom and disk, with one
running physical flow by default. The API derives ownership from the verified
session; job status, recovery and cancellation remain account-scoped. Queued
records survive restarts; interrupted running flows are reported for user review.
The browser recovers active jobs, distinguishes queue wait from runtime and
retries status queries without resubmitting. See [physical-queue.md](physical-queue.md).

The public `#/guia` route provides a lazy-loaded ES/EN portal manual with search,
chapter navigation and annotated screenshots of actual screens using explicit
demonstration fixtures. Its chapters cover both the design workflow and client
device experiments, including local DEVSIM and administrator-only SMTP.

### Engine adapters

Adapters implement a small interface: capability metadata and `run(experiment)`.
The existing `EducationalPNEngine` remains in-process for API compatibility.
The web Device Lab calculates its reference catalogue independently in a client
Worker. Native DEVSIM is already externalized to the user's local companion at
`127.0.0.1:8787`; its PN simulation, mesh-validation and bundle-comparison calls
go directly from the browser to that companion, not through the shared API.

### IIC-OSIC execution worker

The EDA worker derives from the IIC-OSIC-TOOLS image and exposes only named workflows; it does not expose a browser-accessible shell or Docker socket. Connected workflows include RTL lint and simulation, VHDL-2008, Yosys synthesis, ngspice/Xyce, SymbiYosys formal verification, nextpnr iCE40 implementation, openEMS, headless Xschem netlisting, CACE characterization, bounded GDS3D import validation, and asynchronous LibreLane/OpenROAD physical implementation. The capability response distinguishes direct adapters and tools orchestrated inside LibreLane. Physical jobs use validated SKY130/GF180 parameters, bounded runtime and artifact sizes, and a polling contract so long runs do not hold an API request open. Every adapter receives a validated allow-list of file types and options; temporary workspaces are destroyed after portable results have been captured.

### Future worker boundary

Production scientific engines should execute in per-job containers. The API will submit immutable experiment manifests to a queue, and workers will return a normalized result bundle. This prevents solver dependencies and licenses from leaking into the web/API images.

## Common result

A result contains scalar summaries, profiles and I–V series, warnings, convergence metadata, engine provenance, and a stable SHA-256 fingerprint of the canonical input.
