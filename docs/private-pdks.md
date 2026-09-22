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

Physical execution is enabled only for an OpenPDKs-shaped installation containing:

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
