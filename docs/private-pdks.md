# Private PDK registry (BYOPDK)

OpenSemiLab can register user-supplied PDK collateral without redistributing it in this repository or embedding it in exported projects.

## Trust boundary

- The API writes packages to the `opensemilab-pdks` Docker volume.
- The EDA worker mounts that volume read-only.
- Project JSON stores only `private:<registry-id>`.
- Public API responses contain counts and readiness states, not internal paths or file names.
- Archives are extracted without executing installers or scripts. Absolute paths, traversal, symbolic links, hard links, devices, excessive file counts, and configured size-limit violations are rejected.
- Deleting a registry entry removes its extracted content from the private volume. Existing project references then become unresolved.

This registry is intended for a self-hosted installation protected by the institution's authentication and access controls. It does not grant rights to use a PDK; the importer requires the operator to acknowledge that authorization already exists.

## Readiness levels

The scanner recognizes Liberty, LEF, Verilog, SPICE/CDL, GDS/OASIS, parasitic data, layer maps, and open DRC/LVS/OpenRCX inputs. Commercial-tool files may be inventoried, but they are never treated as automatically portable.

The **Prepare open adapter** action runs an internal, atomic server-side compilation. It copies recognized open-compatible views into an isolated OpenPDKs/LibreLane layout, analyzes LEF metadata, writes a draft platform configuration, produces a requirement report and SHA-256 inventory, and stores a downloadable adapter ZIP in the private Docker volume. The ZIP excludes the originally uploaded packages. If multiple technology LEFs match the process (for example, different metal or top-metal variants), compilation stops until the operator selects the exact stack.

The same compilation invokes a non-executing commercial-reference interpreter. It normalizes readable GDS layer maps and Calibre/PVS layer/connectivity statements into `translations/rule-ir.json`, emits KLayout `.lyt`/`.lyp` and an explicitly unvalidated `.lylvs` draft, and recovers conductor, dielectric, and via parameters from readable TLUPlus headers. Encrypted xRC bodies and binary TLUPlus capacitance tables are detected but never guessed or decrypted. The resulting OpenRCX material JSON is bootstrap evidence only: an official OpenRCX calibration must still generate the corner-specific extraction rules.

For M31 libraries, a Milkyway `CEL`/`FRAM` database is not a GDS stream and Verilog is not a transistor-level LVS netlist. The bundle therefore includes precise operator instructions instead of fabricating either view: export GDSII/OASIS in an authorized licensed Synopsys environment with the exact stream-out map, and obtain/export the matching M31 CDL/SPI from its authorized schematic source. Upload those results through **Add missing views**; the server preserves the chosen stack and recompiles automatically.

Adding supplementary views preserves that stack choice and automatically recompiles the adapter. The API exposes only the compilation identifier, aggregate analysis, hashes, readiness gates, and bundle size; private source paths and file names remain server-local.

Readiness is deliberately staged:

| Gate | Required evidence |
|---|---|
| Simulation | SPICE/HSPICE-compatible models |
| Synthesis/timing | Liberty and Verilog cell models |
| OpenROAD inputs | technology LEF, cell LEF, Liberty, and Verilog |
| Physical RTL-to-GDS | OpenROAD inputs plus cell GDS/OASIS, a stream-out technology map, and a reviewed platform configuration (power pins, cell roles, placement site, routing layers, tracks, and PDN) |
| DRC/LVS/PEX | separate open, validated rule decks for each check |

The converter does not claim that Synopsys binary or sign-off formats are losslessly translatable. Compiled `.db` files need an authorized Liberty source/export; Milkyway libraries need an authorized GDS/LEF export; TLUPlus and proprietary DRC/LVS/PEX decks require a separately licensed, calibrated open-tool port. A generated GDS is not equivalent to foundry sign-off.

Each compiled bundle contains `opensemilab-pdk.json`, the generated OpenPDKs tree, `translations/`, `conversion-report.json`, `REQUIRED_INPUTS.json`, `README.md`, and `SHA256SUMS`. Treat the result as a locally derived engineering artifact under the same NDA and license as its inputs.

Physical execution is enabled only for an OpenPDKs-shaped installation containing the required physical views:

```text
<pdk-root>/<pdk>/libs.ref/<scl>/
<pdk-root>/<pdk>/libs.tech/librelane/
```

When automatic selection is ambiguous, include a private profile named `opensemilab-pdk.json` inside one uploaded package:

```json
{
  "schema": "opensemilab.pdk-profile/v1",
  "pdk_root": "relative/path/from/this-profile",
  "pdk": "local_pdk_name",
  "scl": "local_standard_cell_library"
}
```

All fields are logical identifiers or relative paths. The profile must not contain credentials, Drive links, license keys, or host paths. The profile belongs with the confidential package and must not be committed to the public repository.

## Configuration

| Variable | Default | Purpose |
|---|---:|---|
| `OPENSEMILAB_PDK_ROOT` | `/var/lib/opensemilab-pdks` | API registry location |
| `OPENSEMILAB_PRIVATE_PDK_ROOT` | `/var/lib/opensemilab-pdks` | Worker read-only registry location |
| `OPENSEMILAB_PDK_MAX_FILES` | `50000` | Maximum expanded files per import |
| `OPENSEMILAB_PDK_MAX_UPLOAD_BYTES` | `2 GiB` | Maximum uploaded bytes per import |
| `OPENSEMILAB_PDK_MAX_EXPANDED_BYTES` | `8 GiB` | Maximum declared expanded size |

Do not bind-mount a confidential PDK directory into the web container or include it in a Docker build context. Backups of the private volume remain subject to the original PDK license and NDA.
