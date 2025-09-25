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

log "Updating version information"
cd "$REPO_DIR"
if [ -f "update-version.sh" ]; then
  ./update-version.sh || log "Version update failed, continuing..."
else
  log "No version update script found, skipping version update"
fi

log "Building client dist"
cd "$CLIENT_DIR"
npm run build

log "Stopping and restarting docker-compose service to reload server code"
cd "$REPO_DIR"
# Force stop and restart to reload server code (mounted volumes don't auto-restart Node.js)
docker compose -f "$COMPOSE_FILE" down
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

log "Waiting for service to start..."
sleep 10

log "Checking service health"
docker compose -f "$COMPOSE_FILE" ps

log "Recent container logs (last 10 lines):"
docker compose -f "$COMPOSE_FILE" logs --tail=10 api || log "Could not fetch logs"

log "Testing service endpoint..."
if curl -f -s http://localhost/api/v1/config >/dev/null 2>&1; then
  log "Service is responding"
else
  log "Service may not be ready yet"
fi

log "Pruning old unused images (optional)"
docker image prune -f >/dev/null 2>&1 || true

NEW_SHA=$(git rev-parse HEAD)
log "Update complete: $CURRENT_SHA -> $NEW_SHA"
