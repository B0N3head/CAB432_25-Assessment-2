#!/usr/bin/env pwsh
# Quick deployment script - just build and test locally

$ErrorActionPreference = "Stop"

Write-Host "`n=== Quick Local Build & Test ===" -ForegroundColor Cyan

# Clean docker
Write-Host "`n[1/4] Cleaning Docker..." -ForegroundColor Yellow
docker stop $(docker ps -q) 2>$null
docker system prune -af 2>$null
Write-Host "  ✓ Docker cleaned" -ForegroundColor Green

# Build backend
Write-Host "`n[2/4] Building backend..." -ForegroundColor Yellow
docker build -f Dockerfile.backend -t video-editor-backend:latest .
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Backend built" -ForegroundColor Green
} else {
    Write-Host "  ✗ Backend build failed" -ForegroundColor Red
    exit 1
}

# Build frontend
Write-Host "`n[3/4] Building frontend..." -ForegroundColor Yellow
docker build -f Dockerfile.frontend -t video-editor-frontend:latest .
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Frontend built" -ForegroundColor Green
} else {
    Write-Host "  ✗ Frontend build failed" -ForegroundColor Red
    exit 1
}

# Test run
Write-Host "`n[4/4] Starting frontend locally..." -ForegroundColor Yellow
if (Test-Path "docker-compose-frontend-ec2.yml") {
    docker-compose -f docker-compose-frontend-ec2.yml up -d
    Write-Host "  ✓ Frontend running at http://localhost" -ForegroundColor Green
    Write-Host "`nView logs: docker-compose -f docker-compose-frontend-ec2.yml logs -f" -ForegroundColor Cyan
} else {
    Write-Host "  ⚠ No docker-compose file found" -ForegroundColor Yellow
}

Write-Host "`n✓ Build complete!" -ForegroundColor Green
