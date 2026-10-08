#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BACKEND_DIR="$REPO_ROOT/backend"
VENV_DIR="${VENV_DIR:-$REPO_ROOT/.venv}"
PIP_BIN="${PIP_BIN:-$VENV_DIR/bin/pip}"

if [ ! -x "$PIP_BIN" ]; then
  echo "Expected backend virtualenv pip at $PIP_BIN"
  echo "Create the project virtualenv first, then rerun this script."
  exit 1
fi

"$PIP_BIN" freeze > "$BACKEND_DIR/requirements.txt"
echo "Locked backend dependencies to $BACKEND_DIR/requirements.txt"
