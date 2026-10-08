# Go-Live Checklist

Use this after EC2 setup and initial deployment.

## Application Health

- `python backend/smoke_tests.py` passes
- backend service is active: `systemctl status meibography`
- nginx config passes: `nginx -t`
- local health check passes: `curl http://127.0.0.1:5000/api/health`
- ALB target is healthy

## Environment

- `SECRET_KEY` is set to a strong production value
- `DEBUG=false`
- `MODEL_PATH` points to the deployed model-weight directory
- `DATABASE_URL` points to RDS PostgreSQL
- `CORS_ORIGINS` is set to the frontend domain only
- `STORAGE_BACKEND=s3`
- `S3_BUCKET` is correct
- `ENABLE_CAMERA=false` on EC2
- default bootstrap password has been replaced

## Frontend

- frontend was built with `VITE_API_URL=https://api.your-domain.example`
- frontend files were uploaded to the S3 frontend bucket
- CloudFront serves `index.html`
- SPA routes work after browser refresh

## Backend Storage

- uploads are stored successfully
- reports are stored successfully
- report download URLs work through the app

## Security and Routing

- Route53 `app` record points to CloudFront
- Route53 `api` record points to ALB
- ALB redirects `80 -> 443`
- TLS certificates are issued and in use
- RDS is not publicly accessible
- EC2 SSH is limited to your admin IP

## Manual Smoke Test

- open the frontend domain
- log in successfully
- create a patient
- upload a capture
- run analysis
- generate a report
- verify S3 objects were created

## Nice to Add Later

- DB migrations
- CI/CD
- CloudWatch alerts
- Secrets Manager or SSM
- CSRF protection
