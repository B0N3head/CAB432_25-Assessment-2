#!/usr/bin/env pwsh
# Full Deployment Script for Split Architecture
# Purges Docker, builds both images, pushes backend to ECR, runs frontend locally

param(
    [string]$EC2_IP = "",
    [switch]$SkipECR = $false,
    [switch]$SkipFrontend = $false,
    [switch]$Help = $false
)

if ($Help) {
    Write-Host @"
Full Deployment Script for Video Editor Split Architecture

Usage:
    .\deploy-full.ps1 [-EC2_IP <ip>] [-SkipECR] [-SkipFrontend]

Parameters:
    -EC2_IP         Optional: EC2 instance IP to deploy frontend (e.g., "13.239.xxx.xxx")
    -SkipECR        Skip pushing backend to ECR (local testing only)
    -SkipFrontend   Skip building/running frontend container
    -Help           Show this help message

Examples:
    .\deploy-full.ps1                          # Build all, push to ECR, run frontend locally
    .\deploy-full.ps1 -SkipECR                 # Build all, skip ECR push
    .\deploy-full.ps1 -EC2_IP "13.239.xxx.xxx" # Build all, deploy frontend to EC2

"@
    exit 0
}

$ErrorActionPreference = "Stop"

# Configuration
$AWS_REGION = "ap-southeast-2"
$AWS_ACCOUNT = "901444280953"
$ECR_REPO = "$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/n11590041-video-editor"
$BACKEND_IMAGE = "video-editor-backend"
$FRONTEND_IMAGE = "video-editor-frontend"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Video Editor - Full Deployment Script" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Step 1: Stop all containers
Write-Host "[1/8] Stopping all running containers..." -ForegroundColor Yellow
try {
    $runningContainers = docker ps -q
    if ($runningContainers) {
        docker stop $runningContainers
        Write-Host "  ✓ Stopped containers" -ForegroundColor Green
    } else {
        Write-Host "  ✓ No containers running" -ForegroundColor Green
    }
} catch {
    Write-Host "  ⚠ No containers to stop" -ForegroundColor Yellow
}

# Step 2: Purge Docker system
Write-Host "`n[2/8] Purging Docker system (images, containers, cache)..." -ForegroundColor Yellow
try {
    docker system prune -af --volumes 2>$null
    Write-Host "  ✓ Docker system purged" -ForegroundColor Green
} catch {
    Write-Host "  ⚠ Docker purge failed (continuing anyway)" -ForegroundColor Yellow
}

# Step 3: Install dependencies
Write-Host "`n[3/8] Installing Node.js dependencies..." -ForegroundColor Yellow

# Server dependencies
Write-Host "  → Installing server dependencies..." -ForegroundColor Gray
Push-Location server
try {
    npm install --silent 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Server dependencies installed" -ForegroundColor Green
    } else {
        throw "npm install failed"
    }
} catch {
    Write-Host "  ✗ Server npm install failed" -ForegroundColor Red
    Pop-Location
    exit 1
} finally {
    Pop-Location
}

# Client dependencies
Write-Host "  → Installing client dependencies..." -ForegroundColor Gray
Push-Location client
try {
    npm install --silent 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Client dependencies installed" -ForegroundColor Green
    } else {
        throw "npm install failed"
    }
} catch {
    Write-Host "  ✗ Client npm install failed" -ForegroundColor Red
    Pop-Location
    exit 1
} finally {
    Pop-Location
}

# Step 4: Build backend image
Write-Host "`n[4/8] Building backend Docker image..." -ForegroundColor Yellow
docker build -f Dockerfile.backend -t ${BACKEND_IMAGE}:latest . 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Backend image built: ${BACKEND_IMAGE}:latest" -ForegroundColor Green
} else {
    Write-Host "  ✗ Backend build failed" -ForegroundColor Red
    exit 1
}

# Step 5: Build frontend image
if (-not $SkipFrontend) {
    Write-Host "`n[5/8] Building frontend Docker image..." -ForegroundColor Yellow
    docker build -f Dockerfile.frontend -t ${FRONTEND_IMAGE}:latest . 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Frontend image built: ${FRONTEND_IMAGE}:latest" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Frontend build failed" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "`n[5/8] Skipping frontend build (--SkipFrontend flag)" -ForegroundColor Yellow
}

# Step 6: Push backend to ECR
if (-not $SkipECR) {
    Write-Host "`n[6/8] Pushing backend to ECR..." -ForegroundColor Yellow
    
    # Login to ECR
    Write-Host "  → Logging into ECR..." -ForegroundColor Gray
    try {
        aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REPO 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✓ ECR login successful" -ForegroundColor Green
        } else {
            throw "ECR login failed"
        }
    } catch {
        Write-Host "  ✗ ECR login failed - check AWS credentials" -ForegroundColor Red
        exit 1
    }
    
    # Tag image
    Write-Host "  → Tagging image..." -ForegroundColor Gray
    docker tag ${BACKEND_IMAGE}:latest ${ECR_REPO}:backend-latest
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Image tagged" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Image tagging failed" -ForegroundColor Red
        exit 1
    }
    
    # Push to ECR
    Write-Host "  → Pushing to ECR (this may take a few minutes)..." -ForegroundColor Gray
    docker push ${ECR_REPO}:backend-latest 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Backend pushed to ECR: ${ECR_REPO}:backend-latest" -ForegroundColor Green
    } else {
        Write-Host "  ✗ ECR push failed" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "`n[6/8] Skipping ECR push (--SkipECR flag)" -ForegroundColor Yellow
}

# Step 7: Deploy frontend
if (-not $SkipFrontend) {
    Write-Host "`n[7/8] Deploying frontend..." -ForegroundColor Yellow
    
    if ($EC2_IP -ne "") {
        # Deploy to EC2
        Write-Host "  → Deploying to EC2 instance: $EC2_IP" -ForegroundColor Gray
        
        Write-Host "  → Uploading files to EC2..." -ForegroundColor Gray
        try {
            scp Dockerfile.frontend ubuntu@${EC2_IP}:~/ 2>$null
            scp docker-compose-frontend-ec2.yml ubuntu@${EC2_IP}:~/docker-compose.yml 2>$null
            scp -r client ubuntu@${EC2_IP}:~/ 2>$null
            Write-Host "  ✓ Files uploaded to EC2" -ForegroundColor Green
        } catch {
            Write-Host "  ✗ Failed to upload files to EC2" -ForegroundColor Red
            exit 1
        }
        
        Write-Host "  → Building and starting on EC2..." -ForegroundColor Gray
        Write-Host "`n  Run these commands on EC2:" -ForegroundColor Cyan
        Write-Host "    ssh ubuntu@$EC2_IP" -ForegroundColor White
        Write-Host "    cd ~" -ForegroundColor White
        Write-Host "    docker-compose down" -ForegroundColor White
        Write-Host "    docker-compose build --no-cache" -ForegroundColor White
        Write-Host "    docker-compose up -d" -ForegroundColor White
        Write-Host "    docker-compose logs -f" -ForegroundColor White
    } else {
        # Run locally with docker-compose
        Write-Host "  → Starting frontend container locally..." -ForegroundColor Gray
        
        if (Test-Path "docker-compose-frontend-ec2.yml") {
            docker-compose -f docker-compose-frontend-ec2.yml up -d 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  ✓ Frontend container started locally" -ForegroundColor Green
                Write-Host "  → Access at: http://localhost" -ForegroundColor Cyan
            } else {
                Write-Host "  ✗ Failed to start frontend container" -ForegroundColor Red
                exit 1
            }
        } else {
            Write-Host "  ⚠ docker-compose-frontend-ec2.yml not found" -ForegroundColor Yellow
            Write-Host "  → Run manually: docker run -d -p 80:80 ${FRONTEND_IMAGE}:latest" -ForegroundColor Cyan
        }
    }
} else {
    Write-Host "`n[7/8] Skipping frontend deployment (--SkipFrontend flag)" -ForegroundColor Yellow
}

# Step 8: Summary
Write-Host "`n[8/8] Deployment Summary" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan

$backendStatus = if ($SkipECR) { "Built locally (not pushed to ECR)" } else { "Built and pushed to ECR" }
$frontendStatus = if ($SkipFrontend) { "Skipped" } elseif ($EC2_IP -ne "") { "Files uploaded to EC2" } else { "Running locally" }

Write-Host "Backend:  $backendStatus" -ForegroundColor White
Write-Host "Frontend: $frontendStatus" -ForegroundColor White

if (-not $SkipECR) {
    Write-Host "`nNext steps:" -ForegroundColor Yellow
    Write-Host "  1. Go to ECS Console" -ForegroundColor White
    Write-Host "  2. Update service → Force new deployment" -ForegroundColor White
    Write-Host "  3. Wait 2-3 minutes for tasks to restart" -ForegroundColor White
    Write-Host "  4. Check logs in CloudWatch" -ForegroundColor White
}

if (-not $SkipFrontend -and $EC2_IP -eq "") {
    Write-Host "`nLocal frontend:" -ForegroundColor Yellow
    Write-Host "  URL: http://localhost" -ForegroundColor Cyan
    Write-Host "  Logs: docker-compose -f docker-compose-frontend-ec2.yml logs -f" -ForegroundColor White
    Write-Host "  Stop: docker-compose -f docker-compose-frontend-ec2.yml down" -ForegroundColor White
}

Write-Host "`n✓ Deployment complete!" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Cyan
