# Pre-EC2 Checklist

Complete these AWS tasks before launching or configuring EC2.

## Region and Naming

- choose one primary AWS region, for example `ap-south-1`
- decide your domain names:
  - `app.your-domain.example`
  - `api.your-domain.example`
- choose stable resource names:
  - frontend bucket
  - storage bucket
  - RDS instance
  - ALB
  - target group

## DNS and Certificates

- create or confirm the Route53 hosted zone
- request ACM certificate for `app.your-domain.example` in `us-east-1`
- request ACM certificate for `api.your-domain.example` in the app region
- finish DNS validation for both certificates

## Networking

- create or choose a VPC
- create at least 2 public subnets for the ALB
- create at least 2 private subnets for RDS
- attach an internet gateway to the VPC
- configure route tables

## Security Groups

- create `sg-alb-public`
  - inbound `80` from `0.0.0.0/0`
  - inbound `443` from `0.0.0.0/0`
- create `sg-app-ec2`
  - inbound `80` from `sg-alb-public`
  - inbound `22` from your admin IP only
- create `sg-rds-postgres`
  - inbound `5432` from `sg-app-ec2`

## Storage

- create the frontend S3 bucket
- create the storage S3 bucket for uploads and reports
- keep Block Public Access enabled on both buckets

## Database

- create the RDS PostgreSQL instance
- place it in private subnets
- set public access to `No`
- attach `sg-rds-postgres`
- note the RDS endpoint, port, username, password, and DB name

## IAM

- create an IAM role for EC2
- attach the S3 storage policy from `deploy/aws/iam/ec2-s3-storage-policy.json`
- note the role name for the future EC2 instance

## Load Balancing

- create an internet-facing ALB in 2 public subnets
- attach `sg-alb-public`
- create a target group:
  - target type: `Instance`
  - protocol: `HTTP`
  - port: `80`
  - health check path: `/api/health`
  - success code: `200`
- add ALB listeners:
  - `80` redirect to `443`
  - `443` forward to the target group using the API ACM certificate

## Frontend Delivery

- create a CloudFront distribution
- use the frontend S3 bucket as the origin
- enable Origin Access Control
- set alternate domain name to `app.your-domain.example`
- attach the `us-east-1` ACM certificate
- set default root object to `index.html`
- add custom error responses:
  - `403 -> /index.html -> 200`
  - `404 -> /index.html -> 200`

## DNS Routing

- create Route53 alias record for `app` -> CloudFront
- create Route53 alias record for `api` -> ALB

## Prepare for EC2

Have these ready before you launch EC2:

- repo URL
- EC2 IAM role name
- RDS endpoint
- S3 storage bucket name
- frontend bucket name
- domain names
- ACM certificate ARNs
