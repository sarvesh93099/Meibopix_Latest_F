# RDS PostgreSQL Setup

Use these values in the AWS Console to create the PostgreSQL database for this project.

## Console Path

- AWS Console
- RDS
- Databases
- Create database

## Recommended Values

- Create method: `Standard create`
- Engine type: `PostgreSQL`
- Engine version: use the current default stable PostgreSQL version shown by AWS
- Templates: `Dev/Test` for low-cost testing, or `Production` for go-live

## Settings

- DB instance identifier: `meibography-prod-db`
- Master username: `meibography_app`
- Credentials management: `Self managed`
- Master password: `m=ckVbRy=g2HxD=ft6a!*cWjaup7`
- Confirm password: `m=ckVbRy=g2HxD=ft6a!*cWjaup7`

## Instance Configuration

- DB instance class:
  - low-cost start: `db.t3.micro` or the smallest PostgreSQL class available
  - safer production start: `db.t3.small` or `db.t4g.small`

## Storage

- Storage type: `gp3`
- Allocated storage: `20 GiB`
- Storage autoscaling: `On`
- Maximum storage threshold: `100 GiB`

## Availability and Durability

- Multi-AZ deployment:
  - `No` for testing or first low-cost deployment
  - `Yes` for higher production resilience

## Connectivity

- Compute resource: `Don’t connect to an EC2 compute resource`
- Virtual private cloud (VPC): choose the VPC where your future EC2 app server will run
- DB subnet group: choose the private-subnet DB subnet group
- Public access: `No`
- VPC security group: choose `sg-rds-postgres`
- Availability Zone: `No preference`
- Database port: `5432`

## Database Authentication

- Database authentication options: `Password authentication`

## Additional Configuration

- Initial database name: `meibography`
- DB parameter group: `default.postgres`
- Option group: default
- Backup retention:
  - testing: `7 days`
  - production: `7-14 days`
- Enable encryption: `Yes`
- Performance Insights: optional
- Enhanced monitoring: optional
- Auto minor version upgrade: `Yes`
- Deletion protection:
  - testing: `Off`
  - production: `On`

## Resulting DATABASE_URL

After the DB is created, replace `your-rds-endpoint` with the actual RDS endpoint:

```env
DATABASE_URL=postgresql+psycopg2://meibography_app:m=ckVbRy=g2HxD=ft6a!*cWjaup7@your-rds-endpoint:5432/meibography
```

Example shape:

```env
DATABASE_URL=postgresql+psycopg2://meibography_app:m=ckVbRy=g2HxD=ft6a!*cWjaup7@meibography-prod-db.abc123xyz.ap-south-1.rds.amazonaws.com:5432/meibography
```

## What to Copy Into .env

Use:

- username: `meibography_app`
- password: `m=ckVbRy=g2HxD=ft6a!*cWjaup7`
- database name: `meibography`
- port: `5432`
- endpoint: the one AWS shows on the RDS Connectivity page
