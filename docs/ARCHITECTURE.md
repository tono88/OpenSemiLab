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

### Orchestration API

FastAPI validates experiment contracts, discovers engine capabilities, selects adapters, normalizes output, and attaches provenance.

### Engine adapters

Adapters implement a small interface: capability metadata and `run(experiment)`. The current `EducationalPNEngine` is in-process. DEVSIM and later engines will be externalized behind the same boundary.

### Future worker boundary

Production scientific engines should execute in per-job containers. The API will submit immutable experiment manifests to a queue, and workers will return a normalized result bundle. This prevents solver dependencies and licenses from leaking into the web/API images.

## Common result

A result contains scalar summaries, profiles and I–V series, warnings, convergence metadata, engine provenance, and a stable SHA-256 fingerprint of the canonical input.
