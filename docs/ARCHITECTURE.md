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
- **Device Lab** starts from semiconductor physics and exposes progressively deeper model and numerical controls.

Design Studio intentionally maps outcomes to tools instead of reproducing the desktop menus of IIC-OSIC-TOOLS. Native tools remain behind adapters and isolated workers.

### Orchestration API

FastAPI validates experiment contracts, discovers engine capabilities, selects adapters, normalizes output, and attaches provenance.

### Engine adapters

Adapters implement a small interface: capability metadata and `run(experiment)`. The current `EducationalPNEngine` is in-process. DEVSIM and later engines will be externalized behind the same boundary.

### IIC-OSIC execution worker

The EDA worker derives from the IIC-OSIC-TOOLS image and exposes only named workflows; it does not expose a browser-accessible shell or Docker socket. The first connected workflows are RTL lint, Icarus Verilog simulation, and Yosys synthesis. Jobs have source-size, filename, process, CPU, memory, output, and timeout limits. Temporary workspaces are destroyed after every job.

### Future worker boundary

Production scientific engines should execute in per-job containers. The API will submit immutable experiment manifests to a queue, and workers will return a normalized result bundle. This prevents solver dependencies and licenses from leaking into the web/API images.

## Common result

A result contains scalar summaries, profiles and I–V series, warnings, convergence metadata, engine provenance, and a stable SHA-256 fingerprint of the canonical input.
