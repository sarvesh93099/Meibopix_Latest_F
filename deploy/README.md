# Deployment Assets

This folder contains deployment-related assets for the project.

## Recommended Entry Points

- Oracle backend + Vercel frontend: `deploy/ORACLE_VERCEL.md`
- AWS overview: `deploy/aws/README.md`
- Full AWS deployment flow: `deploy/AWS_DEPLOYMENT.md`
- GitHub Actions CI/CD: `deploy/GITHUB_ACTIONS.md`
- Docker setup: `deploy/DOCKER.md`
- Checkpoint deployment without Git LFS: `deploy/MODELS.md`
- Pre-EC2 checklist: `deploy/aws/checklists/PRE_EC2.md`
- RDS setup values: `deploy/aws/checklists/RDS_SETUP.md`
- S3/CloudFront/Route53 setup: `deploy/aws/checklists/S3_CLOUDFRONT_ROUTE53_SETUP.md`
- Go-live checklist: `deploy/aws/checklists/GO_LIVE.md`

## Folder Layout

```text
deploy/
  README.md
  AWS_DEPLOYMENT.md
  aws/
    README.md
    checklists/
    env/
    iam/
  nginx/
  scripts/
  systemd/
```

## Runtime Assets

These are the files used directly by the server setup scripts:

- Oracle backend setup: `deploy/scripts/oracle_setup.sh`
- Oracle production environment: `deploy/oracle/production.env.example`
- Vercel routing template: `deploy/vercel/vercel.json.example`
- nginx config: `deploy/nginx/meibography.conf`
- systemd service: `deploy/systemd/meibography.service`
- EC2 setup: `deploy/scripts/ec2_setup.sh`
- EC2 update: `deploy/scripts/ec2_update.sh`
- backend dependency lock refresh: `deploy/scripts/lock_backend_requirements.sh`
- frontend S3 publish: `deploy/scripts/s3_sync_frontend.sh`
- backend profile installation: `deploy/scripts/install_backend.sh`
- checkpoint verification/sync: `deploy/scripts/manage_models.py`

## Notes

- The `deploy/aws/` folder is organized for manual AWS setup and project handoff.
- The `deploy/nginx/`, `deploy/systemd/`, and `deploy/scripts/` folders remain stable so the existing setup flow keeps working.
