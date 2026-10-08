#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/meibography}"
REPO_ROOT="${REPO_ROOT:-$APP_ROOT/meibography}"
BACKEND_DIR="$REPO_ROOT/backend"
FRONTEND_DIR="$REPO_ROOT/frontend"
VENV_DIR="$REPO_ROOT/.venv"
APP_USER="${APP_USER:-$USER}"
APP_GROUP="${APP_GROUP:-$(id -gn "$APP_USER")}"
LOG_DIR="${LOG_DIR:-/var/log/meibography}"

sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip python3-dev nginx nodejs npm git curl awscli libglib2.0-0 libgl1

sudo mkdir -p "$APP_ROOT"
sudo chown -R "$USER":"$USER" "$APP_ROOT"
sudo mkdir -p "$LOG_DIR"
sudo chown -R "$APP_USER":"$APP_GROUP" "$LOG_DIR"
sudo chmod 750 "$LOG_DIR"

if [ ! -f "$BACKEND_DIR/serve.py" ]; then
  echo "Copy or clone the project into $REPO_ROOT before running this script."
  exit 1
fi

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --upgrade pip wheel
REPO_ROOT="$REPO_ROOT" bash "$REPO_ROOT/deploy/scripts/install_backend.sh"

cd "$FRONTEND_DIR"
npm ci
npm run build

if [ ! -f "$REPO_ROOT/.env" ]; then
  cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
  echo "Created $REPO_ROOT/.env from template. Update it before going live."
fi
chmod 600 "$REPO_ROOT/.env"

TMP_SERVICE_FILE="$(mktemp)"
sed \
  -e "s/^User=.*/User=$APP_USER/" \
  -e "s/^Group=.*/Group=$APP_GROUP/" \
  "$REPO_ROOT/deploy/systemd/meibography.service" > "$TMP_SERVICE_FILE"
sudo cp "$TMP_SERVICE_FILE" /etc/systemd/system/meibography.service
rm -f "$TMP_SERVICE_FILE"

sudo cp "$REPO_ROOT/deploy/nginx/meibography.conf" /etc/nginx/sites-available/meibography
sudo ln -sf /etc/nginx/sites-available/meibography /etc/nginx/sites-enabled/meibography
sudo rm -f /etc/nginx/sites-enabled/default

mkdir -p "$BACKEND_DIR/uploads" "$BACKEND_DIR/reports"
sudo chown -R "$APP_USER":"$APP_GROUP" "$BACKEND_DIR/uploads" "$BACKEND_DIR/reports" "$BACKEND_DIR"/*.db 2>/dev/null || true

sudo systemctl enable nginx
sudo systemctl daemon-reload
sudo systemctl enable meibography
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl restart meibography

echo "EC2 setup complete."
echo "Next:"
echo "1. Edit $REPO_ROOT/.env with production values"
echo "2. Set DATABASE_URL to your RDS PostgreSQL connection string"
echo "3. Set STORAGE_BACKEND=s3, S3_BUCKET, and AWS_REGION"
echo "4. Attach an IAM role with S3 access to the EC2 instance"
echo "5. Point your ALB/CloudFront or domain to this server and enable HTTPS"
