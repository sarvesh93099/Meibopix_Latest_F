#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
PYTHON="$REPO_ROOT/.venv/bin/python"

if [ "${TORCH_DEVICE:-cpu}" = "cpu" ]; then
  "$PYTHON" -m pip install --disable-pip-version-check --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple -r "$REPO_ROOT/backend/requirements.txt"
elif [ "${TORCH_DEVICE:-cpu}" = "cuda" ]; then
  "$PYTHON" -m pip install --disable-pip-version-check -r "$REPO_ROOT/backend/requirements.txt"
else
  echo "TORCH_DEVICE must be cpu or cuda."
  exit 1
fi

"$PYTHON" "$REPO_ROOT/deploy/scripts/manage_models.py" sync
