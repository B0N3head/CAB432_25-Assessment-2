# Video Editor

Current features
- Upload multiple media files (video/audio).
- Arrange clips into tracks (V1..Vn / A1..An) onto a timeline
- Realtime preview of the timeline in-browser
- Sequence rendering server-side with **ffmpeg** (export only as mp4)
- Hard coded login

## How to start (local)

Requirements: Node 20+, ffmpeg (added to path)

```bash
# 1) Server
cd server
cp .env.example .env
npm ci
npm run dev        # http://localhost:3000

# 2) Client
cd ../client
npm ci
npm run dev        # http://localhost:5173 (Vite)
# In dev, set VITE_API_BASE in client/.env to point to your server if needed (default: http://localhost:3000)
```

## Build & run in Docker

Untested :)

```bash
# From repo root
docker build -t vid-editor-api:latest .
# Run on port 80 (container exposes 3000)
docker run --rm -p 80:3000 -e NODE_ENV=production vid-editor-api:latest
```

## Deploy to AWS (ECR → EC2)

1. Build: `docker build -t <aws_account_id>.dkr.ecr.<region>.amazonaws.com/vid-editor-api:latest .`
2. Login + Push to ECR.
3. On EC2: `docker run -d --name vidapp -p 80:3000 <ecr_repo>/vid-editor-api:latest`  
4. Verify API: `curl http://<ec2-public-ip>/api/v1/health`

## Load test (CPU >80% for ≥5 minutes)

- First upload a few long videos.
- Create a project with multiple tracks and clips.
- Then run:

```bash
# scripts/loadtest.sh
bash ./scripts/loadtest.sh http://<host> <JWT> <PROJECT_ID> 30
```

This triggers many render requests in parallel with slow presets (x264 `-preset veryslow` and multiple renditions). On t3.micro this keeps CPU >80% for minutes. Monitor EC2 CPU in AWS Console.

## Data types

- **Unstructured files**: uploaded media + thumbnails + final renders (`/data/uploads`, `/data/thumbnails`, `/data/outputs`)
- **Structured metadata**: users (in code), file records, projects, timelines, and jobs in `data/db.json`

## Security

- Demo-only hard-coded users (see `server/src/auth/users.js`).
- JWT secures API routes. Public: `/api/v1/auth/login`, static client.
- Ownership enforced on files/projects; admin can manage all.

## Notes / Limitations

- Preview is a client-side approximation (layered `<video>` tags + simple audio). 
- Final audio mix is produced at render time server-side.
- Only basic compositing (no transparency/effects)—higher tracks overlay lower ones.