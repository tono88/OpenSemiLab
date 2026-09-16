# Licensing strategy

OpenSemiLab original code is Apache-2.0. Each external engine, PDK, model library, and container image remains governed by its own license.

## Integration policy

- Prefer adapters that invoke external engines as separate processes or services.
- Do not copy external source code into this repository without an explicit compatibility review.
- Do not redistribute PDKs by default; provide documented installation hooks.
- Record engine and PDK identifiers in result provenance.
- A connector being technically possible does not grant redistribution rights.

| Component | Intended relationship |
|---|---|
| DEVSIM | Optional external TCAD engine; adapter package only here |
| Gmsh | Optional external meshing service/tool |
| MOOSE / FEniCSx | Future external multiphysics workers |
| IIC-OSIC-TOOLS | Future isolated EDA worker environment, not vendored |
| Open PDKs | Installed separately according to each PDK's terms |

This file is engineering guidance, not legal advice. Every release that redistributes an external binary or dataset requires a license review.
