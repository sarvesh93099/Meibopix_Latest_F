# Docker Guide

This project now includes Docker support for both backend and frontend.

## Files

- `backend/Dockerfile`
- `frontend/Dockerfile`
- `frontend/nginx.conf`
- `docker-compose.yml`
- `.dockerignore`

## What This Gives You

- same runtime environment across local, EC2, and future container platforms
- fewer machine-specific dependency issues
- one command to run backend and frontend together

## Before You Run

Compose mounts `backend/meibography_models/` into the backend read-only. Keep the trained `.pth` files there and verify them using `python deploy/scripts/manage_models.py verify` before starting a segmentation host. Weights are excluded from application images, reducing the Docker build context by about 504 MB. See [MODELS.md](MODELS.md) for manual-copy and private-S3 deployment without Git LFS.

Make sure `.env` exists at the repo root.

Minimum required values:

```env
SECRET_KEY=replace-with-a-real-secret
AUTH_BOOTSTRAP_USERNAME=your-admin-user
AUTH_BOOTSTRAP_PASSWORD=replace-with-a-strong-password
DEBUG=false
ENABLE_CAMERA=false
```

Optional but recommended:

```env
DATABASE_URL=sqlite:////app/data/meibography.db
VITE_API_URL=
```

Notes:

- leave `VITE_API_URL` empty if you want the frontend container to use nginx proxying to the backend container
- set `VITE_API_URL=https://api.your-domain.example` if you want a frontend image that points directly to an external API

## Run Locally With Docker Compose

The backend image installs the complete dependency list from `backend/requirements.txt`. Segmentation also requires the trained checkpoint files.

For a standalone backend build:

CPU builds use the official CPU PyTorch packages. For a GPU host, set `TORCH_DEVICE=cuda` in `.env` or pass `--build-arg TORCH_DEVICE=cuda`, and configure the NVIDIA runtime before running the container.

```bash
docker build --build-arg TORCH_DEVICE=cpu -f backend/Dockerfile -t meibography-backend .
```

The segmentation networks load only when analysis runs. A model status request checks availability without loading weights. The recruiter guest preview can be served by the frontend alone.

```bash
docker compose up --build
```

App URLs:

- frontend: `http://localhost:8080`
- backend API: `http://localhost:5000`

## Run Smoke Tests Before Building

```bash
python backend/smoke_tests.py
```

## Build Images Separately

Backend:

```bash
docker build -f backend/Dockerfile -t meibography-backend .
```

Frontend:

```bash
docker build -f frontend/Dockerfile -t meibography-frontend .
```

Frontend with explicit API URL:

```bash
docker build -f frontend/Dockerfile --build-arg VITE_API_URL=https://api.your-domain.example -t meibography-frontend .
```

## Deployment Notes

- backend image runs `python serve.py` with Waitress on port `5000`
- frontend image serves the built SPA with nginx on port `80`
- local Docker Compose uses a named volume for backend SQLite/uploads/reports data
- for AWS production, you would normally still use RDS and S3 instead of relying on container-local storage

## Recommended Next Container Step

If you want to go beyond EC2, the next natural move is:

- ECS Fargate for the backend container
- S3 + CloudFront for the frontend, or ECS/nginx if you want both containerized
