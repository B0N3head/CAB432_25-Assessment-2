#!/bin/bash

# Docker Restart Script for Video Editor
# This script rebuilds the client, updates containers with new environment variables, and restarts services

set -e  # Exit on any error

echo "Restarting Video Editor Docker Services..."

# Change to project directory
cd "$(dirname "$0")"

echo "Building client..."
cd client
npm run build
cd ..

echo "Stopping existing containers..."
docker-compose down

echo "Removing old containers and images (optional cleanup)..."
docker container prune -f
# Uncomment next line for more aggressive cleanup:
# docker system prune -f

echo "Starting services with fresh environment..."
docker-compose up -d

echo "Waiting for services to start..."
sleep 10

echo "Checking service status..."
docker-compose ps

echo "Container logs (last 20 lines):"
docker-compose logs --tail=20 api

echo "Restart complete! Services should be running with updated environment."
echo "Check status at: http://videoeditor.cab432.com/api/v1/config"
echo "To monitor logs: docker-compose logs -f api"
echo "To check health: docker-compose ps"