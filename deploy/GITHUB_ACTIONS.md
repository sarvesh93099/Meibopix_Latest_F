# GitHub Actions CI/CD

This repo now includes a GitHub Actions workflow at `.github/workflows/ci-cd.yml`.

## What It Does

On every pull request:

- installs the core backend dependencies without PyTorch or model downloads
- runs `python backend/smoke_tests.py --skip-ml` and the backend regression suite
- installs frontend dependencies
- builds the frontend

On pushes to `main`:

- runs the same CI checks
- optionally deploys the backend to EC2
- optionally uploads the frontend build to S3 and invalidates CloudFront

Automatic deploy on push is disabled until you set:

- repository variable `ENABLE_AUTO_DEPLOY=true`

You can also run the workflow manually from GitHub Actions using `workflow_dispatch`.

Enable `run_ml_tests` on a manual run to install the full profile, fetch verified checkpoints from the `MODEL_SOURCE` repository variable, and run real inference checks. Use a private S3 prefix and the AWS credentials below. Routine CI and EC2 deployment do not require Git LFS. See [MODELS.md](MODELS.md).

## Required GitHub Secrets

Backend EC2 deploy:

- `EC2_HOST`
- `EC2_USER`
- `EC2_SSH_PRIVATE_KEY`
- `EC2_KNOWN_HOSTS`

Frontend AWS deploy:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

## Recommended GitHub Variables

- `ENABLE_AUTO_DEPLOY`
- `EC2_PORT`
- `EC2_APP_ROOT`
- `SKIP_FRONTEND_BUILD_ON_EC2`
- `AWS_REGION`
- `FRONTEND_S3_BUCKET`
- `CLOUDFRONT_DISTRIBUTION_ID`
- `VITE_API_URL`

Suggested values:

```text
ENABLE_AUTO_DEPLOY=true
EC2_PORT=22
EC2_APP_ROOT=/opt/meibography
SKIP_FRONTEND_BUILD_ON_EC2=true
AWS_REGION=ap-south-1
FRONTEND_S3_BUCKET=meibography-frontend-prod
CLOUDFRONT_DISTRIBUTION_ID=E1234567890ABC
VITE_API_URL=https://api.your-domain.example
```

## Notes

- `EC2_KNOWN_HOSTS` should contain the exact host key entry from `ssh-keyscan -H your-ec2-host`
- backend deploy uses `deploy/scripts/ec2_update.sh`
- frontend deploy uploads the workflow-built `frontend/dist` artifact to S3
- if you still want EC2 to build and serve the frontend itself, set `SKIP_FRONTEND_BUILD_ON_EC2=false`
