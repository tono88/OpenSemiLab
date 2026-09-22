# GT2N integration policy

OpenSemiLab exposes GT2N as a **research-only project profile**. It does not advertise an executable or production-qualified RTL-to-GDSII route for this PDK.

## What GT2N contributes

The initial GT2N release provides useful collateral for 2 nm GAAFET/BSPDN research and benchmarking:

- 72 standard cells and Liberty timing models;
- technology and cell LEF plus standard-cell GDS and CDL;
- thermal-calibrated 3-stack nanosheet SPICE model cards;
- ICT, QRC technology, ITF and NXTGRD extraction collateral;
- Synopsys IC Validator DRC/LVS runsets and OpenAccess views.

The upstream README also says that its three process corners are under development. The included OpenROAD example is currently distributed as `gt2n_openroad_runscripts_no_work_20260601.tar.gz`. Consequently, merely copying GT2N files into the worker would create an unreliable and potentially misleading flow.

## Qualification gates before executable support

An OpenSemiLab GT2N adapter may move from research-only to executable only after all of these gates are met:

1. A reproducible, unpacked OpenROAD reference flow completes on a pinned tool version.
2. Liberty, LEF, GDS, CDL and extraction views use one explicitly selected width/VT/corner combination.
3. Routing layers, vias, RC corners, site/track definitions and power intent are cross-validated.
4. DRC and LVS pass with the supplied ICV decks, or equivalent independently validated open decks are available.
5. Post-route STA, extraction, antenna, power-grid and regression results are archived with checksums.
6. Licensing and any commercial-tool requirements are documented.

Even after these engineering gates pass, GT2N remains a research flow unless a manufacturing foundry supplies qualified production rules, models and tape-out authorization.

## Relationship to SKY130 and GF180

GT2N is a separate process, cell architecture and model set. It cannot be used to sign off or improve the manufacturability of a SKY130 or GF180 layout. It can help compare architectures and exercise model-integration workflows, while production readiness must be assessed against the exact target foundry PDK.

Upstream project: <https://github.com/azadnaeemi/GT2N>
