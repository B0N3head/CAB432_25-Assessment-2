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
npm i
npm run dev        # http://localhost:3000

# 2) Client
cd ../client
npm i
npm run dev        # http://localhost:5173 (Vite)
# In dev, set VITE_API_BASE in client/.env to point to your server if needed (default: http://localhost:3000)
```

Verify API: `curl http://<ec2-public-ip>/api/v1/health`

## Load test (CPU >80% for ≥5 minutes)

- First upload a few long videos.
- Create a project with multiple tracks and clips.
- Then run:

```bash
# scripts/loadtest.sh
bash ./scripts/loadtest.sh http://<host> <JWT> <PROJECT_ID> 30
```

This triggers many render requests in parallel with slow presets (x264 `-preset veryslow` and multiple renditions). On t3.micro this keeps CPU >80% for minutes. Monitor EC2 CPU in AWS Console.
