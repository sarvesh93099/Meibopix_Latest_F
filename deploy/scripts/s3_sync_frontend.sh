#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: ./deploy/scripts/s3_sync_frontend.sh s3://your-bucket-name"
  exit 1
fi

BUCKET_URI="$1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"

if [ -z "${VITE_API_URL:-}" ]; then
  echo "VITE_API_URL is not set."
  echo "The built frontend will call relative /api URLs."
  echo "For S3/CloudFront frontend plus EC2 backend, export VITE_API_URL=https://api.your-domain.example"
fi

cd "$FRONTEND_DIR"
npm ci
npm run build

aws s3 sync dist/assets/ "$BUCKET_URI/assets/" --delete --cache-control "public, max-age=31536000, immutable"
aws s3 sync dist/ "$BUCKET_URI" --delete --exclude "assets/*" --cache-control "public, max-age=300, must-revalidate"

if [ -n "${CLOUDFRONT_DISTRIBUTION_ID:-}" ]; then
  aws cloudfront create-invalidation --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" --paths "/*"
fi

echo "Frontend uploaded to $BUCKET_URI"
echo "If you use CloudFront, create an invalidation after sync."
