# S3 + CloudFront + Route53 Setup

Use these values in the AWS Console to create the frontend delivery path for this project.

## 1. Frontend S3 Bucket

Console path:

- AWS Console
- S3
- Create bucket

Recommended values:

- Bucket name: `meibography-frontend-prod`
- AWS Region: choose the same region you use for the project, for example `ap-south-1`
- Object Ownership: `Bucket owner enforced`
- Block Public Access: `On`
- Versioning: optional, but `On` is helpful for rollback
- Default encryption: `SSE-S3`

Important:

- do not use the S3 website endpoint as the CloudFront origin
- keep the bucket private

## 2. Upload Frontend Build Later

When you are ready to publish, use:

```bash
export VITE_API_URL=https://api.your-domain.example
export CLOUDFRONT_DISTRIBUTION_ID=YOUR_DISTRIBUTION_ID
./deploy/scripts/s3_sync_frontend.sh s3://meibography-frontend-prod
```

## 3. ACM Certificate for Frontend

CloudFront requires the frontend ACM certificate in `us-east-1`.

Console path:

- switch region to `US East (N. Virginia)` (`us-east-1`)
- AWS Console
- Certificate Manager
- Request

Recommended values:

- Certificate type: `Request a public certificate`
- Fully qualified domain name: `app.your-domain.example`
- Validation method: `DNS validation`
- Key algorithm: default

Then create the DNS validation records that ACM gives you.

## 4. CloudFront Distribution

Console path:

- AWS Console
- CloudFront
- Create distribution

Recommended values:

### Origin

- Origin domain: select the S3 bucket `meibography-frontend-prod`
- Origin type: `S3`
- Origin access: `Origin access control settings (recommended)`
- Origin access control: create new
  - Name: `meibography-frontend-oac`
  - Origin type: `S3`
  - Signing behavior: `Sign requests (recommended)`
- Enable origin shield: `Off`

### Default Cache Behavior

- Viewer protocol policy: `Redirect HTTP to HTTPS`
- Allowed HTTP methods: `GET, HEAD`
- Cache policy: `CachingOptimized`
- Compress objects automatically: `Yes`
- Restrict viewer access: `No`

### Settings

- Price class: `Use only North America and Europe` for lowest cost, or `Use all edge locations` for best global delivery
- Alternate domain name (CNAME): `app.your-domain.example`
- Custom SSL certificate: choose the ACM certificate for `app.your-domain.example`
- Supported HTTP versions: default
- Default root object: `index.html`
- IPv6: `On`
- Web Application Firewall: optional

### Custom Error Responses

After the distribution is created, edit it and add:

- `403` -> response page path `/index.html` -> response code `200`
- `404` -> response page path `/index.html` -> response code `200`

This is for React SPA routing.

## 5. S3 Bucket Policy for CloudFront OAC

After CloudFront creates the distribution, allow only that distribution to read the bucket.

Use the template in:

- `deploy/aws/iam/cloudfront-oac-s3-read-policy.json`

Replace:

- `YOUR_FRONTEND_BUCKET_NAME`
- `YOUR_AWS_ACCOUNT_ID`
- `YOUR_CLOUDFRONT_DISTRIBUTION_ID`

Then apply the policy to the frontend bucket.

## 6. Route53 DNS

Console path:

- AWS Console
- Route53
- Hosted zones
- your domain

Create these records:

### Frontend record

- Record name: `app`
- Record type: `A`
- Alias: `Yes`
- Route traffic to: `Alias to CloudFront distribution`
- Choose the distribution for `app.your-domain.example`
- Evaluate target health: `No`

If IPv6 is enabled on CloudFront, also create:

- Record name: `app`
- Record type: `AAAA`
- Alias: `Yes`
- Route traffic to: same CloudFront distribution

### Backend record

- Record name: `api`
- Record type: `A`
- Alias: `Yes`
- Route traffic to: `Alias to Application and Classic Load Balancer`
- choose your ALB

## 7. Final Frontend Values

Use these values in the project:

- frontend domain: `https://app.your-domain.example`
- backend API base URL: `https://api.your-domain.example`

In `.env` on the backend:

```env
CORS_ORIGINS=https://app.your-domain.example
```

When building the frontend for S3:

```bash
export VITE_API_URL=https://api.your-domain.example
```

## 8. Verification

After deployment:

- CloudFront distribution status becomes `Deployed`
- ACM certificate status becomes `Issued`
- Route53 record resolves to CloudFront
- opening `https://app.your-domain.example` loads the React app
- refreshing a nested React route still loads the app
