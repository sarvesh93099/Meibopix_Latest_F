# AWS Deployment Structure

This project is organized for the following AWS deployment model:

- frontend: S3 + CloudFront
- backend API: EC2 + nginx + systemd
- database: RDS PostgreSQL
- storage: S3
- DNS/TLS: Route53 + ACM

## Start Here

- Full deployment flow: `deploy/AWS_DEPLOYMENT.md`
- Pre-EC2 tasks: `deploy/aws/checklists/PRE_EC2.md`
- RDS setup values: `deploy/aws/checklists/RDS_SETUP.md`
- S3/CloudFront/Route53 setup: `deploy/aws/checklists/S3_CLOUDFRONT_ROUTE53_SETUP.md`
- Production validation: `deploy/aws/checklists/GO_LIVE.md`
- Production env template: `deploy/aws/env/production.env.example`
- Example EC2 IAM policy: `deploy/aws/iam/ec2-s3-storage-policy.json`
- Example CloudFront bucket policy: `deploy/aws/iam/cloudfront-oac-s3-read-policy.json`

## Why This Folder Exists

The repo already had runnable deployment files under `deploy/scripts`, `deploy/nginx`, and `deploy/systemd`.
This `deploy/aws/` folder adds a cleaner AWS-oriented structure around them so deployment planning is easier.

## Canonical Runtime Files

Use these actual runtime assets when configuring the server:

- `deploy/scripts/ec2_setup.sh`
- `deploy/scripts/ec2_update.sh`
- `deploy/scripts/s3_sync_frontend.sh`
- `deploy/nginx/meibography.conf`
- `deploy/systemd/meibography.service`
