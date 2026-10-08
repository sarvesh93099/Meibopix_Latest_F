# AWS Deployment Guide

For a more structured view of the AWS deployment assets, start with:

- `deploy/README.md`
- `deploy/aws/README.md`
- `deploy/GITHUB_ACTIONS.md`
- `deploy/DOCKER.md`
- `deploy/aws/checklists/PRE_EC2.md`
- `deploy/aws/checklists/GO_LIVE.md`
- `deploy/aws/env/production.env.example`
- `deploy/aws/iam/ec2-s3-storage-policy.json`

This project is closest to production-ready with this AWS layout:

- Frontend: S3 + CloudFront
- Backend API: EC2 + nginx + systemd
- Database: RDS PostgreSQL
- File storage: S3
- TLS/DNS: ACM + Route53
- Secrets/config: Systems Manager Parameter Store or Secrets Manager
- Logs/alerts: CloudWatch

Primary application API surface:

- `POST /api/upload`
- `POST /api/predict`
- `GET/POST /api/results`

## 1. Prepare AWS Resources

Create these resources first:

- 1 EC2 instance for the Flask backend
- 1 RDS PostgreSQL instance
- 1 S3 bucket for the frontend static build
- 1 S3 bucket or prefix for uploads and reports
- 1 CloudFront distribution for the frontend bucket
- 1 ACM certificate for your domain
- 1 Route53 hosted zone or DNS records in your current DNS provider
- 1 IAM instance role for EC2 with access to the storage bucket

Recommended DNS split:

- `app.your-domain.example` -> CloudFront
- `api.your-domain.example` -> ALB or EC2 public endpoint

If you do not want split frontend/backend domains yet, you can also serve the frontend from the EC2 box instead of S3.

## 2. Configure the Backend Server

SSH into EC2 and clone the repository into `/opt/meibography/meibography`.

Run:

```bash
cd /opt/meibography/meibography
chmod +x deploy/scripts/ec2_setup.sh deploy/scripts/ec2_update.sh
./deploy/scripts/ec2_setup.sh
```

What the setup script now does:

- installs system packages, nginx, and awscli; no Git LFS client is required
- verifies local model weights or installs missing weights from `MODEL_SOURCE`
- creates the Python virtual environment
- installs backend dependencies from the locked `backend/requirements.txt`
- builds the frontend
- installs the systemd and nginx configs
- creates the log directory

Dependency notes:

- see [MODELS.md](MODELS.md) for manual-copy or private-S3 checkpoint deployment
- checkpoints remain on local server storage and are never fetched during an image request

- backend Python dependencies are pinned in `backend/requirements.txt`
- frontend JavaScript dependencies are pinned by `frontend/package-lock.json` and installed with `npm ci`
- refresh backend dependency pins from the project virtualenv with `deploy/scripts/lock_backend_requirements.sh`

## 3. Fill Production Environment Variables

Edit `/opt/meibography/meibography/.env`.

Minimum production values:

```env
HOST=0.0.0.0
PORT=5000
DEBUG=false
SECRET_KEY=replace-with-a-long-random-secret
MODEL_PATH=/opt/meibography/meibography/backend/meibography_models
DATABASE_URL=postgresql+psycopg2://USER:PASSWORD@RDS-ENDPOINT:5432/meibography
CORS_ORIGINS=https://app.your-domain.example
ENFORCE_HTTPS=true
SESSION_COOKIE_SECURE=true
AUTH_COOKIE_SAMESITE=None
STORAGE_BACKEND=s3
S3_BUCKET=your-storage-bucket
AWS_REGION=ap-south-1
AUTH_BOOTSTRAP_USERNAME=your-admin-user
AUTH_BOOTSTRAP_PASSWORD=replace-with-a-strong-password
ENABLE_CAMERA=false
```

Important notes:

- use RDS, not SQLite, for production
- keep `ENABLE_CAMERA=false` on EC2 unless that server really has a local camera
- leave `APP_LOG_FILE` empty unless you intentionally want rotating file logs in addition to stdout/journald
- use `APP_LOG_ACCESS_LOGS=true` to keep one-line request logs for `/api`, `/uploads`, and `/reports`
- when file logging is enabled, `APP_LOG_MAX_BYTES` and `APP_LOG_BACKUP_COUNT` control rotation

## 4. Configure S3 Storage Access

Attach an IAM role to EC2 with permissions for:

- `s3:GetObject`
- `s3:PutObject`
- `s3:DeleteObject`
- `s3:ListBucket`

Scope the permissions to your upload/report bucket only.

## 5. Publish the Frontend to S3

For a split frontend/backend deployment, build with the API URL:

```bash
export VITE_API_URL=https://api.your-domain.example
./deploy/scripts/s3_sync_frontend.sh s3://your-frontend-bucket
```

Then configure CloudFront:

- origin = the S3 frontend bucket
- default root object = `index.html`
- add custom error handling so 403/404 return `/index.html` with 200 for React routing
- if your API is on a different origin, do not route `/api/*` through this distribution unless you intentionally want that setup

## 6. Configure nginx

The nginx config is already prepared for:

- serving the built frontend locally when needed
- proxying `/api/`, `/uploads/`, and `/reports/` to Flask
- preserving forwarded HTTPS information from AWS proxies

Before go-live, update `server_name` in `deploy/nginx/meibography.conf` if you are using a direct domain on the EC2 host.

Reload after changes:

```bash
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl restart meibography
```

## 7. Configure Health Checks

Use this backend health endpoint:

- `GET /api/health`

Example:

- ALB target group health check path: `/api/health`
- success code: `200`

The backend now allows this endpoint without forcing an HTTPS redirect, which makes AWS health checks simpler.

## 8. Configure Security Groups

Allow:

- 22 from your admin IP only
- 80 and 443 from the internet if EC2 is directly public
- 80 from the ALB only if using a private target group
- 5432 only from the backend security group to RDS

Do not expose PostgreSQL publicly.

## 9. Add a Repeatable Deploy Flow

For code updates on EC2:

```bash
cd /opt/meibography/meibography
./deploy/scripts/ec2_update.sh
```

This script:

- pulls the latest git branch
- reuses verified local model files, syncing missing checkpoints from `MODEL_SOURCE` if configured
- reinstalls backend dependencies
- rebuilds the frontend
- restarts the backend service

## 10. Production Checklist

Before calling the app deployment-ready, confirm:

- `python backend/smoke_tests.py` passes locally or in the EC2 virtualenv
- `frontend/dist` builds successfully
- EC2 can start `meibography.service`
- `curl http://127.0.0.1:5000/api/health` works on the instance
- nginx serves the app correctly
- RDS connection works
- uploads and reports save to S3
- the IAM role is attached
- CloudFront serves the frontend
- CORS allows only your frontend domain
- the default bootstrap password has been changed
- DNS and TLS are active

## 11. Recommended Next DevOps Improvements

These are still worth adding after first deployment:

- database migrations with Alembic or Flask-Migrate
- CloudWatch alarms for EC2 health, 5xx errors, and disk usage
- SSM/Secrets Manager instead of plain `.env` secrets
- regular RDS snapshots and S3 lifecycle policies
- CSRF protection for cookie-authenticated API requests
