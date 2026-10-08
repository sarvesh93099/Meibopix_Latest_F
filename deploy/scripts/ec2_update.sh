#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/meibography}"
REPO_ROOT="${REPO_ROOT:-$APP_ROOT/meibography}"
BACKEND_DIR="$REPO_ROOT/backend"
FRONTEND_DIR="$REPO_ROOT/frontend"
VENV_DIR="$REPO_ROOT/.venv"
GIT_BRANCH="${GIT_BRANCH:-main}"
SKIP_FRONTEND_BUILD="${SKIP_FRONTEND_BUILD:-false}"

if [ ! -f "$BACKEND_DIR/serve.py" ]; then
  echo "Project not found at $REPO_ROOT"
  exit 1
fi

cd "$REPO_ROOT"
if [ -d "$REPO_ROOT/.git" ]; then
  export GIT_LFS_SKIP_SMUDGE=1
  git -c filter.lfs.required=false -c filter.lfs.smudge=cat fetch origin --prune
  git -c filter.lfs.required=false -c filter.lfs.smudge=cat checkout "$GIT_BRANCH"
  git -c filter.lfs.required=false -c filter.lfs.smudge=cat pull --ff-only origin "$GIT_BRANCH"
else
  echo "Using uploaded source files; no Git checkout required."
fi

REPO_ROOT="$REPO_ROOT" bash "$REPO_ROOT/deploy/scripts/install_backend.sh"

if [ "$SKIP_FRONTEND_BUILD" != "true" ]; then
  cd "$FRONTEND_DIR"
  npm ci
  npm run build
fi

sudo nginx -t
sudo systemctl restart nginx
sudo systemctl restart meibography
sudo systemctl status meibography --no-pager --lines=20
