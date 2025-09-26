#!/bin/bash

# Docker Restart Script for Video Editor
# This script rebuilds the client, updates containers with new environment variables, and restarts services

set -e  # Exit on any error

echo "Restarting Video Editor Docker Services..."

# Change to project root directory (parent of scripts)
cd "$(dirname "$0")/.."

echo "Building client..."
cd client
npm run build
cd ..

echo "Installing server dependencies (if needed)..."
cd server
npm install --omit=dev
cd ..

echo "Stopping existing containers..."
# Try docker compose (newer syntax) first, fall back to docker-compose
if command -v "docker" >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
else
    DOCKER_COMPOSE="docker-compose"
fi

$DOCKER_COMPOSE down

echo "Removing old containers and images (optional cleanup)..."
docker container prune -f
# Uncomment next line for more aggressive cleanup:
# docker system prune -f

echo "Starting services with fresh environment..."
$DOCKER_COMPOSE up -d

echo "Waiting for services to start..."
sleep 10

echo "Checking service status..."
$DOCKER_COMPOSE ps

echo "Container logs (last 20 lines):"
$DOCKER_COMPOSE logs --tail=20 api

echo "Restart complete! Services should be running with updated environment."
echo "Check status at: https://videoeditor.cab432.com/api/v1/config"
echo "To monitor logs: $DOCKER_COMPOSE logs -f api"
echo "To check health: $DOCKER_COMPOSE ps"