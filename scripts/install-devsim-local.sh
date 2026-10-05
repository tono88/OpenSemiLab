#!/usr/bin/env sh
set -eu

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VENV_DIR="${OPENSEMILAB_DEVSIM_VENV:-$REPO_DIR/.venv-devsim}"
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install "$REPO_DIR/services/devsim-worker"

if [ -e /usr/lib/x86_64-linux-gnu/liblapack.so.3 ]; then
  export DEVSIM_MATH_LIBS="${DEVSIM_MATH_LIBS:-liblapack.so.3:libblas.so.3}"
fi
printf '%s\n' "DEVSIM is installed. Starting the local companion at http://127.0.0.1:8787"
exec "$VENV_DIR/bin/opensemilab-devsim"
