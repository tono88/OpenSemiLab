#!/usr/bin/env bash
# The upstream environment script intentionally probes optional, potentially
# unset variables (PYTHONPATH, CPATH, STD_CELL_LIBRARY, DESIGNS, and others).
# Keep fail-fast and pipe checking, but do not enable Bash nounset while it is
# sourced or the container exits before the worker starts.
set -eo pipefail

export IIC_OSIC_TOOLS_QUIET=1

if [[ ! -r /etc/profile.d/iic-osic-tools-setup.sh ]]; then
  echo "Missing IIC-OSIC environment initializer" >&2
  exit 1
fi

# The upstream image installs the EDA binaries outside the system PATH. Its
# profile script exposes /foss/tools/bin and the PDK environment to processes.
source /etc/profile.d/iic-osic-tools-setup.sh

# Our own code uses guarded parameter expansion, so strict unset checking is
# safe again after the upstream environment has finished initializing.
set -u

echo "OpenSemiLab activated IIC-OSIC-TOOLS ${IIC_OSIC_TOOLS_VERSION:-unknown}"
echo "Tool root: ${TOOLS:-unset}"
exec python3 /opt/opensemilab-worker/worker.py
