#!/usr/bin/env bash
set -euo pipefail

export IIC_OSIC_TOOLS_QUIET=1

if [[ ! -r /etc/profile.d/iic-osic-tools-setup.sh ]]; then
  echo "Missing IIC-OSIC environment initializer" >&2
  exit 1
fi

# The upstream image installs the EDA binaries outside the system PATH. Its
# profile script exposes /foss/tools/bin and the PDK environment to processes.
source /etc/profile.d/iic-osic-tools-setup.sh

echo "OpenSemiLab activated IIC-OSIC-TOOLS ${IIC_OSIC_TOOLS_VERSION:-unknown}"
echo "Tool root: ${TOOLS:-unset}"
exec python3 /opt/opensemilab-worker/worker.py
