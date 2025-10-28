#!/usr/bin/env pwsh
# Verify all files have correct syntax before deployment

$ErrorActionPreference = "Continue"

Write-Host "`n=== Pre-Deployment Verification ===" -ForegroundColor Cyan

$allPassed = $true

# Check server files
Write-Host "`n[1/3] Checking server files..." -ForegroundColor Yellow
$serverFiles = @(
    "server/src/index.js",
    "server/src/worker.js",
    "server/src/queue.js",
    "server/src/routes.js",
    "server/src/s3.js",
    "server/src/storage.js",
    "server/src/video.js",
    "server/src/config.js"
)

foreach ($file in $serverFiles) {
    if (Test-Path $file) {
        Write-Host "  → Checking $file..." -ForegroundColor Gray -NoNewline
        node --check $file 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host " ✓" -ForegroundColor Green
        } else {
            Write-Host " ✗" -ForegroundColor Red
            $allPassed = $false
        }
    } else {
        Write-Host "  ⚠ $file not found" -ForegroundColor Yellow
    }
}

# Check Dockerfiles
Write-Host "`n[2/3] Checking Dockerfiles..." -ForegroundColor Yellow
$dockerfiles = @("Dockerfile.backend", "Dockerfile.frontend")

foreach ($dockerfile in $dockerfiles) {
    if (Test-Path $dockerfile) {
        Write-Host "  ✓ $dockerfile exists" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $dockerfile missing" -ForegroundColor Red
        $allPassed = $false
    }
}

# Check package.json files
Write-Host "`n[3/3] Checking package.json dependencies..." -ForegroundColor Yellow

Write-Host "  → Checking server/package.json..." -ForegroundColor Gray -NoNewline
if (Test-Path "server/package.json") {
    $serverPkg = Get-Content "server/package.json" | ConvertFrom-Json
    $requiredDeps = @("@aws-sdk/client-sqs", "@aws-sdk/client-s3", "@aws-sdk/client-dynamodb", "express")
    $missingDeps = @()
    
    foreach ($dep in $requiredDeps) {
        if (-not $serverPkg.dependencies.PSObject.Properties[$dep]) {
            $missingDeps += $dep
        }
    }
    
    if ($missingDeps.Count -eq 0) {
        Write-Host " ✓" -ForegroundColor Green
    } else {
        Write-Host " ✗ Missing: $($missingDeps -join ', ')" -ForegroundColor Red
        $allPassed = $false
    }
} else {
    Write-Host " ✗ Not found" -ForegroundColor Red
    $allPassed = $false
}

Write-Host "  → Checking client/package.json..." -ForegroundColor Gray -NoNewline
if (Test-Path "client/package.json") {
    Write-Host " ✓" -ForegroundColor Green
} else {
    Write-Host " ✗ Not found" -ForegroundColor Red
    $allPassed = $false
}

# Summary
Write-Host "`n================================" -ForegroundColor Cyan
if ($allPassed) {
    Write-Host "✓ All checks passed!" -ForegroundColor Green
    Write-Host "`nReady to deploy. Run:" -ForegroundColor Yellow
    Write-Host "  .\deploy-full.ps1" -ForegroundColor White
    exit 0
} else {
    Write-Host "✗ Some checks failed" -ForegroundColor Red
    Write-Host "`nFix the errors above before deploying." -ForegroundColor Yellow
    exit 1
}
