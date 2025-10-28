#!/bin/bash
# Quick deployment script - just build and test locally

set -e

echo -e "\n=== Quick Local Build & Test ==="

# Clean docker
echo -e "\n\033[1;33m[1/4] Cleaning Docker...\033[0m"
if [ -n "$(docker ps -q)" ]; then
    docker stop $(docker ps -q) 2>/dev/null || true
fi
docker system prune -af 2>/dev/null || true
echo -e "  \033[1;32m✓ Docker cleaned\033[0m"

# Build backend
echo -e "\n\033[1;33m[2/4] Building backend...\033[0m"
docker build -f Dockerfile.backend -t video-editor-backend:latest .
if [ $? -eq 0 ]; then
    echo -e "  \033[1;32m✓ Backend built\033[0m"
else
    echo -e "  \033[1;31m✗ Backend build failed\033[0m"
    exit 1
fi

# Build frontend
echo -e "\n\033[1;33m[3/4] Building frontend...\033[0m"
docker build -f Dockerfile.frontend -t video-editor-frontend:latest .
if [ $? -eq 0 ]; then
    echo -e "  \033[1;32m✓ Frontend built\033[0m"
else
    echo -e "  \033[1;31m✗ Frontend build failed\033[0m"
    exit 1
fi

# Test run
echo -e "\n\033[1;33m[4/4] Starting frontend locally...\033[0m"
if [ -f "docker-compose-frontend-ec2.yml" ]; then
    docker-compose -f docker-compose-frontend-ec2.yml up -d
    echo -e "  \033[1;32m✓ Frontend running at http://localhost\033[0m"
    echo -e "\n\033[1;36mView logs:\033[0m docker-compose -f docker-compose-frontend-ec2.yml logs -f"
else
    echo -e "  \033[1;33m⚠ No docker-compose file found\033[0m"
fi

echo -e "\n\033[1;32m✓ Build complete!\033[0m"
