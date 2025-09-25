#!/usr/bin/env bash
set -euo pipefail

# Auto update script: pull latest git, install dependencies (without deleting existing node_modules),
# rebuild client, restart docker-compose service. Intended to be run via cron or AWS SSM.

REPO_DIR="/opt/video-editor"   # Adjust to where the repo lives on the instance
BRANCH="main"
COMPOSE_FILE="${REPO_DIR}/docker-compose.yml"
SERVER_DIR="${REPO_DIR}/server"
CLIENT_DIR="${REPO_DIR}/client"

log() { echo "[auto-update] $*"; }

if [ ! -d "$REPO_DIR/.git" ]; then
  log "Repository not found at $REPO_DIR" >&2
  exit 1
fi

cd "$REPO_DIR"

CURRENT_SHA=$(git rev-parse HEAD || echo "unknown")
log "Current commit: $CURRENT_SHA"

log "Fetching origin..."
git fetch origin "$BRANCH" --quiet

REMOTE_SHA=$(git rev-parse origin/$BRANCH)
log "Remote commit:  $REMOTE_SHA"

if [ "$CURRENT_SHA" = "$REMOTE_SHA" ]; then
  log "Already up to date. Exiting."
  exit 0
fi

log "Updating working tree to origin/$BRANCH"
git reset --hard "origin/$BRANCH" --quiet

log "Installing server dependencies (npm ci fallback to npm install)" 
cd "$SERVER_DIR"
if [ -f package-lock.json ]; then
  npm install --no-audit --no-fund --progress=false
else
  npm install --no-audit --no-fund --progress=false
fi

log "Installing client dependencies"
cd "$CLIENT_DIR"
if [ -f package-lock.json ]; then
  npm install --no-audit --no-fund --progress=false
else
  npm install --no-audit --no-fund --progress=false
fi

log "Building client dist"
npm run build

log "Restarting docker-compose service"
cd "$REPO_DIR"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

log "Pruning old unused images (optional)"
docker image prune -f >/dev/null 2>&1 || true

NEW_SHA=$(git rev-parse HEAD)
log "Update complete: $CURRENT_SHA -> $NEW_SHA"
