#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/opt/meibography/meibography}"
APP_USER="${APP_USER:-ubuntu}"
APP_GROUP="$(id -gn "$APP_USER")"
: "${API_DOMAIN:?Set API_DOMAIN to your Oracle API hostname, without https://}"

if [[ ! "$API_DOMAIN" =~ ^[a-zA-Z0-9.-]+$ ]] || [[ "$API_DOMAIN" == *REPLACE* ]]; then
  echo "Supply a real DNS hostname for API_DOMAIN."
  exit 1
fi
if [ "$REPO_ROOT" != /opt/meibography/meibography ]; then
  echo "This service template uses /opt/meibography/meibography; copy the project there."
  exit 1
fi
if [ ! -f "$REPO_ROOT/.env" ] || [ ! -f "$REPO_ROOT/backend/serve.py" ]; then
  echo "Upload the project and configure its .env before setup."
  exit 1
fi

sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-dev python3-tk build-essential nginx libglib2.0-0 libgl1
sudo chown -R "$APP_USER:$APP_GROUP" "$REPO_ROOT"
chmod 600 "$REPO_ROOT/.env"
if [ ! -x "$REPO_ROOT/.venv/bin/python" ]; then
  python3 -m venv "$REPO_ROOT/.venv"
fi
"$REPO_ROOT/.venv/bin/python" -m pip install --upgrade pip wheel
REPO_ROOT="$REPO_ROOT" TORCH_DEVICE=cpu bash "$REPO_ROOT/deploy/scripts/install_backend.sh"

# Load the real production configuration before installing/restarting the service.
(cd "$REPO_ROOT/backend" && "$REPO_ROOT/.venv/bin/python" -B -c 'from app.factory import app; print("Production configuration loaded successfully.")')

service_file="$(mktemp)"
nginx_file="$(mktemp)"
trap 'rm -f "$service_file" "$nginx_file"' EXIT
sed -e "s/^User=.*/User=$APP_USER/" -e "s/^Group=.*/Group=$APP_GROUP/" \
  "$REPO_ROOT/deploy/systemd/meibography.service" > "$service_file"
sudo install -m 644 "$service_file" /etc/systemd/system/meibography.service
sed "s/REPLACE_API_DOMAIN/$API_DOMAIN/g" "$REPO_ROOT/deploy/oracle/api.conf.template" > "$nginx_file"
sudo install -m 644 "$nginx_file" /etc/nginx/sites-available/meibography-api
sudo ln -sfn /etc/nginx/sites-available/meibography-api /etc/nginx/sites-enabled/meibography-api
if [ -L /etc/nginx/sites-enabled/default ]; then
  sudo unlink /etc/nginx/sites-enabled/default
fi
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now meibography nginx
sudo systemctl restart meibography
sudo systemctl reload nginx
echo "Backend installed. Next enable HTTPS for $API_DOMAIN, then configure Vercel."
if [ "$(uname -m)" = aarch64 ]; then
  echo "ARM profile: browser blink features are supported; legacy server MediaPipe recheck is unavailable."
fi
