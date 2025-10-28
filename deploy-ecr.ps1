#!/usr/bin/env pwsh
# ECR-only deployment - build backend and push to ECR

param(
    [switch]$NoBuild = $false
)

$ErrorActionPreference = "Stop"

$AWS_REGION = "ap-southeast-2"
$AWS_ACCOUNT = "901444280953"
$ECR_REPO = "$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/n11590041-video-editor"
$BACKEND_IMAGE = "video-editor-backend"

Write-Host "`n=== Backend ECR Deployment ===" -ForegroundColor Cyan

if (-not $NoBuild) {
    # Build backend
    Write-Host "`n[1/3] Building backend image..." -ForegroundColor Yellow
    docker build -f Dockerfile.backend -t ${BACKEND_IMAGE}:latest .
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Backend built successfully" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Build failed" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "`n[1/3] Skipping build (--NoBuild flag)" -ForegroundColor Yellow
}

# Login to ECR
Write-Host "`n[2/3] Logging into ECR..." -ForegroundColor Yellow
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REPO 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ ECR login successful" -ForegroundColor Green
} else {
    Write-Host "  ✗ ECR login failed - check AWS credentials" -ForegroundColor Red
    exit 1
}

# Tag and push
Write-Host "`n[3/3] Pushing to ECR..." -ForegroundColor Yellow
Write-Host "  → Tagging image..." -ForegroundColor Gray
docker tag ${BACKEND_IMAGE}:latest ${ECR_REPO}:backend-latest

Write-Host "  → Pushing (this may take 2-3 minutes)..." -ForegroundColor Gray
docker push ${ECR_REPO}:backend-latest
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Pushed to: ${ECR_REPO}:backend-latest" -ForegroundColor Green
} else {
    Write-Host "  ✗ Push failed" -ForegroundColor Red
    exit 1
}

Write-Host "`n✓ ECR deployment complete!" -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "  1. Go to ECS Console" -ForegroundColor White
Write-Host "  2. Services → Update service" -ForegroundColor White
Write-Host "  3. Check 'Force new deployment'" -ForegroundColor White
Write-Host "  4. Click Update" -ForegroundColor White
Write-Host "  5. Monitor tasks in CloudWatch Logs`n" -ForegroundColor White
