param(
    [switch]$Major,
    [switch]$Minor,
    [switch]$Patch
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

# Determine version bump type
$versionType = "patch"  # Default to patch
if ($Major) { $versionType = "major" }
elseif ($Minor) { $versionType = "minor" }
elseif ($Patch) { $versionType = "patch" }

# Update server package.json version
Push-Location server
try {
    npm version $versionType --no-git-tag-version | Out-Null
    $newVersion = (Get-Content package.json | ConvertFrom-Json).version
    Write-Host "New version: $newVersion" -ForegroundColor Green
}
catch {
    Write-Host "Error updating server version: $_" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

# Update client package.json to match
Push-Location client
try {
    $clientPackage = Get-Content package.json | ConvertFrom-Json
    $clientPackage.version = $newVersion
    $clientPackage | ConvertTo-Json -Depth 10 | Set-Content package.json -Encoding UTF8
}
catch {
    Write-Host "Error updating client version: $_" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

# Create a build info file that the server can read
$buildInfo = @{
    version = $newVersion
    buildTime = $buildTime
    deployDate = $deployDate
    gitHash = $gitHash
} | ConvertTo-Json -Depth 10

Set-Content -Path "server/build-info.json" -Value $buildInfo -Encoding UTF8

Write-Host "Version updated to $newVersion" -ForegroundColor Green

# Display current version info
Write-Host "`nCurrent build info:" -ForegroundColor Cyan
Write-Host $buildInfo -ForegroundColor Gray
Write-Host "`nForce update on server with bash /opt/video-editor/scripts/auto-update.sh:" -ForegroundColor Yellow