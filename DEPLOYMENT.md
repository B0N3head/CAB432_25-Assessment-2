# Deployment guide (AWS EC2 + Docker)

This document explains how to deploy the application to an Ubuntu EC2 instance using Docker, and how to configure the new AWS integrations you now have in the codebase: Cognito, S3 pre-signed uploads, Parameter Store, Secrets Manager, ElastiCache (Memcached), and SSE.

The instructions assume:
- You already have an Ubuntu EC2 you can SSH into, with Docker installed.
- You can rebuild the instance image or re-run provisioning easily.

If you prefer ECS/Fargate or IaC (Terraform/CDK), you can adapt the same environment variables and IAM permissions.

---

## 1) Build and push the Docker image

On your dev machine (or CI):

1. Create an ECR repository (e.g., `vid-editor-api`).
2. Authenticate Docker to ECR.
3. Build and push:

```powershell
# From repo root on Windows PowerShell
docker build -t vid-editor-api:latest .

# Tag for ECR
$ACCOUNT="<aws_account_id>"; $REGION="ap-southeast-2"; $REPO="vid-editor-api"
docker tag vid-editor-api:latest $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:latest

# Login to ECR and push
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
docker push $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:latest
```

On EC2:

```bash
docker pull <account>.dkr.ecr.<region>.amazonaws.com/vid-editor-api:latest
```

---

## 2) Create and attach IAM role to the EC2 instance

The server needs to call AWS APIs. Create an IAM role and attach it to the EC2 instance with these permissions (least privilege):

- SSM Parameter Store (read): `ssm:GetParameter`
- Secrets Manager (read): `secretsmanager:GetSecretValue`
- S3 (bucket you use): `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`
- ElastiCache: no direct IAM; access is via VPC security group (see §5)
- Cognito JWKS is public (HTTPS), no IAM needed

Example policy names:
- `VideoEditor-SSMRead`
- `VideoEditor-SecretsRead`
- `VideoEditor-S3AppBucketAccess`

Attach the role to the EC2 instance (stop/start may be required if not using managed instance profiles).

---

## 3) Provision AWS resources

You can do this manually first, then move to IaC. Minimal set:

### Cognito
- Create a User Pool
- Create App Client (no secret for Hosted UI implicit flow)
- Enable email sign-up + confirmation
- Enable MFA (TOTP recommended)
- Create groups: `Admin`, `Editor`, `Viewer` and assign users
- Configure a Hosted UI domain
- Allowed callback URL: your app origin (e.g., `http://yourdomain.cab432.com`)

### S3
- Create a bucket (e.g., `video-editor-<yourname>`) for uploads/outputs/thumbnails
- Add CORS:
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET","PUT","HEAD"],
    "AllowedOrigins": ["*"]
  }
]
```
Adjust `AllowedOrigins` to your domain in production.

### ElastiCache (Memcached)
- Create a Memcached cluster in the same VPC/Subnets as your EC2 (or reachable via security groups)
- Note the endpoint, e.g., `mycache.xxxxxx.cfg.apse2.cache.amazonaws.com:11211`
- Allow inbound from your EC2 security group on port 11211

### Route 53
- Create a `CNAME` record for a subdomain of `cab432.com` that points to your EC2 public DNS name (for A2 core DNS marks)

---

## 4) Configure parameters and secrets

The server reads from `.env` first, then overlays values from SSM/Secrets if available.

### Environment variables (baseline)
Create `/opt/vid-editor/.env` on EC2 (or use docker `--env-file`):

```
NODE_ENV=production
PORT=3000
AWS_REGION=ap-southeast-2

# Cognito (set all 3 to enable Cognito auth)
COGNITO_USER_POOL_ID=ap-southeast-2_xxxxx
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxx
COGNITO_DOMAIN=https://your-domain.auth.ap-southeast-2.amazoncognito.com

# S3 (set bucket to enable S3 presigned uploads/downloads)
S3_BUCKET=video-editor-yourname
S3_UPLOADS_PREFIX=uploads/
S3_OUTPUTS_PREFIX=outputs/
S3_THUMBS_PREFIX=thumbnails/

# ElastiCache Memcached (optional but recommended)
MEMCACHED_URL=memcached://mycache.xxxxxx.cfg.apse2.cache.amazonaws.com:11211

# Dev fallback secret (not used when Cognito is enabled)
JWT_SECRET=devsecret
```

### SSM Parameter Store (optional overlay)
Create parameters to centralize config (names are configurable):

```
/app/video-editor/cognito/userPoolId = ap-southeast-2_xxxxx
/app/video-editor/cognito/clientId   = xxxxxxxxxxxxxxxxxxxx
/app/video-editor/cognito/domain     = https://your-domain.auth.ap-southeast-2.amazoncognito.com
/app/video-editor/s3/bucket          = video-editor-yourname
/app/video-editor/cache/memcachedUrl = memcached://mycache.xxxxxx.cfg.apse2.cache.amazonaws.com:11211
```

### Secrets Manager (optional overlay)
If you still need a JWT secret (dev) or other secrets, store them in Secrets Manager and set:

```
SECRETS_JWT_SECRET_NAME=video-editor/jwt
```

---

## 5) Run the container on EC2

Create a working directory and copy the env file:

```bash
sudo mkdir -p /opt/vid-editor
sudo nano /opt/vid-editor/.env   # paste the env contents
```

Run the container (replace <repo> with your ECR repo URL):

```bash
docker run -d --name vid-editor \
  --env-file /opt/vid-editor/.env \
  -p 80:3000 \
  <account>.dkr.ecr.<region>.amazonaws.com/vid-editor-api:latest
```

Notes:
- No host volumes are required once S3 is used for media. If you still use local storage, add a volume for `/app/server/data`.
- Ensure the EC2 IAM role is attached so the app can read SSM/Secrets and access S3.

---

## 6) Verify the deployment

From your laptop:

```powershell
curl http://<ec2-public-dns-or-domain>/api/v1/health
curl http://<ec2-public-dns-or-domain>/api/v1/config
```

Open the site in a browser at `http://<domain>`.

### Login
- If Cognito is configured, click “Login with Cognito” and complete signup/login + email confirmation if needed.
- If Cognito is not configured, you can use the legacy local login (dev only).

### Upload
- Use the Library upload input; with S3 configured, files upload directly to your bucket using presigned URLs.

### Render & progress
- Create a project; add clips; click Render.
- The client opens an SSE connection to `/api/v1/jobs/:id/events` and shows progress.

---

## 7) Common issues

- 403 or failing SSM/Secrets: Check IAM role attached to EC2 and its policies.
- S3 upload CORS errors: Fix bucket CORS to include your origin and PUT/GET/HEAD.
- SSE disconnects behind load balancers: For now on EC2 direct it’s fine; if behind ALB, enable idle timeouts and sticky sessions or rely on reconnection; our server sends heartbeats.
- Memcached connection refused: Ensure EC2 security group is allowed in ElastiCache SG and same VPC/subnet routing.
- Cognito callback mismatch: The Hosted UI app client must include your exact redirect URI.

---

## 8) Next steps (Core features for A2)

- Move metadata from file-based `data/db.json` to DynamoDB for full statelessness.
- Add Terraform/CDK definitions for all resources above to qualify for IaC marks.
- Add Route 53 CNAME for your `cab432.com` subdomain to the EC2 public DNS.
