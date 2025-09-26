param(
    [switch]$Major,
    [switch]$Minor,
    [switch]$Patch,
    [switch]$Server,
    [switch]$Client,
    [switch]$Both
)

# Get current date in ISO format
$buildTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$deployDate = Get-Date -Format "yyyy-MM-dd HH:mm"

# Get git commit hash (short) if available
$gitHash = ""
try {
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $gitHash = git rev-parse --short HEAD 2>$null
        if ($LASTEXITCODE -ne 0) { $gitHash = "" }
    }
}
catch {
    $gitHash = ""
}

Write-Host "Updating version information..." -ForegroundColor Green
Write-Host "Build time: $buildTime" -ForegroundColor Yellow
Write-Host "Git hash: $(if($gitHash){"$gitHash"}else{"N/A"})" -ForegroundColor Yellow

# Determine what to update
$updateServer = $Server -or $Both -or (-not $Server -and -not $Client -and -not $Both)  # Default to both if no flags
$updateClient = $Client -or $Both -or (-not $Server -and -not $Client -and -not $Both)  # Default to both if no flags

# Determine version bump type
$versionType = "patch"  # Default to patch
if ($Major) { $versionType = "major" }
elseif ($Minor) { $versionType = "minor" }
elseif ($Patch) { $versionType = "patch" }

$serverVersion = ""
$clientVersion = ""

# Update server package.json version
if ($updateServer) {
    Write-Host "Updating server version..." -ForegroundColor Cyan
    Push-Location server
    try {
        npm version $versionType --no-git-tag-version | Out-Null
        $serverVersion = (Get-Content package.json | ConvertFrom-Json).version
        Write-Host "Server version: $serverVersion" -ForegroundColor Green
    }
    catch {
        Write-Host "Error updating server version: $_" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Pop-Location
} else {
    # Get current server version without updating
    Push-Location server
    try {
        $serverVersion = (Get-Content package.json | ConvertFrom-Json).version
        Write-Host "Server version (unchanged): $serverVersion" -ForegroundColor Yellow
    }
    catch {
        Write-Host "Error reading server version: $_" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Pop-Location
}

# Update client package.json version
if ($updateClient) {
    Write-Host "Updating client version..." -ForegroundColor Cyan
    Push-Location client
    try {
        npm version $versionType --no-git-tag-version | Out-Null
        $clientVersion = (Get-Content package.json | ConvertFrom-Json).version
        Write-Host "Client version: $clientVersion" -ForegroundColor Green
    }
    catch {
        Write-Host "Error updating client version: $_" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Pop-Location
} else {
    # Get current client version without updating
    Push-Location client
    try {
        $clientVersion = (Get-Content package.json | ConvertFrom-Json).version
        Write-Host "Client version (unchanged): $clientVersion" -ForegroundColor Yellow
    }
    catch {
        Write-Host "Error reading client version: $_" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Pop-Location
}

# Create a build info file that the server can read
$buildInfo = @{
    serverVersion = $serverVersion
    clientVersion = $clientVersion
    buildTime = $buildTime
    deployDate = $deployDate
    gitHash = $gitHash
} | ConvertTo-Json -Depth 10

# Write build-info.json without BOM to prevent any potential parsing issues
[System.IO.File]::WriteAllText((Join-Path (Get-Location) "server/build-info.json"), $buildInfo, [System.Text.UTF8Encoding]::new($false))

Write-Host "`nVersion Update Summary:" -ForegroundColor Green
Write-Host "======================" -ForegroundColor Green
Write-Host "Server: $serverVersion" -ForegroundColor $(if($updateServer){"Green"}else{"Yellow"})
Write-Host "Client: $clientVersion" -ForegroundColor $(if($updateClient){"Green"}else{"Yellow"})

# Display current version info
Write-Host "`nCurrent build info:" -ForegroundColor Cyan
Write-Host $buildInfo -ForegroundColor Gray

Write-Host "`nUsage Examples:" -ForegroundColor Cyan
Write-Host "  .\update-version.ps1                    # Update both (default)" -ForegroundColor Gray
Write-Host "  .\update-version.ps1 -Server           # Update server only" -ForegroundColor Gray
Write-Host "  .\update-version.ps1 -Client           # Update client only" -ForegroundColor Gray
Write-Host "  .\update-version.ps1 -Both -Major      # Major version bump for both" -ForegroundColor Gray
Write-Host "  .\update-version.ps1 -Server -Minor    # Minor version bump for server only" -ForegroundColor Gray

Write-Host "`nForce update on server with bash /opt/video-editor/scripts/auto-update.sh:" -ForegroundColor Yellow