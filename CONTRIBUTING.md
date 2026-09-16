# Contributing

OpenSemiLab welcomes teaching material, engine adapters, validation cases, UI improvements, and documentation.

## Before opening a change

1. Open an issue describing the learner or researcher need.
2. State whether the change is educational, numerical, or infrastructure-related.
3. Keep engine-specific behavior behind the adapter interface.
4. Never describe an approximation as a validated professional result.

## Scientific checklist

- Every numeric field has a unit.
- Assumptions and boundary conditions are explicit.
- Solver and version are recorded in provenance.
- A numerical model includes a cited reference or derivation.
- A professional engine integration includes convergence and validation tests.
- Examples avoid proprietary PDK content and confidential process data.

## Development

Create a branch, add tests, run `pytest` in `services/api`, run `npm run build` in `apps/web`, and submit a focused pull request.
