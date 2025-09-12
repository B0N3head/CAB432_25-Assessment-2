#!/usr/bin/env bash
# Usage: bash scripts/loadtest.sh http://host AUTH_JWT PROJECT_ID PARALLEL
# Example: bash scripts/loadtest.sh http://localhost "Bearer eyJ..." abc123 30

set -euo pipefail

HOST="${1:-http://localhost}"
AUTH="${2:-}"
PROJ="${3:-}"
PAR="${4:-20}"

if [[ -z "$AUTH" || -z "$PROJ" ]]; then
  echo "Usage: $0 HOST AUTH_JWT PROJECT_ID [PARALLEL]" >&2
  exit 1
fi

echo "Kicking off $PAR parallel render jobs on project $PROJ ..."

for i in $(seq 1 "$PAR"); do
  curl -s -X POST "$HOST/api/v1/projects/$PROJ/render" \
    -H "Authorization: $AUTH" \
    -H "Content-Type: application/json" \
    -d '{"preset":"crispstream","renditions":["1080p","720p","480p"]}' \
    > /dev/null &
done

wait
echo "All render requests sent. Monitor CPU on EC2 Monitoring tab."
