#!/bin/bash
# Full Deployment Script for Split Architecture
# Purges Docker, builds both images, pushes backend to ECR, runs frontend locally

set -e

# Configuration
AWS_REGION="ap-southeast-2"
AWS_ACCOUNT="901444280953"
ECR_REPO="$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/n11590041-video-editor"
BACKEND_IMAGE="video-editor-backend"
FRONTEND_IMAGE="video-editor-frontend"

# Parse arguments
EC2_IP=""
SKIP_ECR=false
SKIP_FRONTEND=false
HELP=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --ec2-ip)
            EC2_IP="$2"
            shift 2
            ;;
        --skip-ecr)
            SKIP_ECR=true
            shift
            ;;
        --skip-frontend)
            SKIP_FRONTEND=true
            shift
            ;;
        --help|-h)
            HELP=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

if [ "$HELP" = true ]; then
    cat << EOF
Full Deployment Script for Video Editor Split Architecture

Usage:
    ./deploy-full.sh [OPTIONS]

Options:
    --ec2-ip <ip>       Optional: EC2 instance IP to deploy frontend (e.g., "13.239.xxx.xxx")
    --skip-ecr          Skip pushing backend to ECR (local testing only)
    --skip-frontend     Skip building/running frontend container
    --help, -h          Show this help message

Examples:
    ./deploy-full.sh                          # Build all, push to ECR, run frontend locally
    ./deploy-full.sh --skip-ecr               # Build all, skip ECR push
    ./deploy-full.sh --ec2-ip "13.239.xxx.xxx" # Build all, deploy frontend to EC2

EOF
    exit 0
fi

echo -e "\n========================================"
echo "Video Editor - Full Deployment Script"
echo -e "========================================\n"

# Step 1: Stop all containers
echo -e "\033[1;33m[1/8] Stopping all running containers...\033[0m"
if [ -n "$(docker ps -q)" ]; then
    docker stop $(docker ps -q) || true
    echo -e "  \033[1;32m✓ Stopped containers\033[0m"
else
    echo -e "  \033[1;32m✓ No containers running\033[0m"
fi

# Step 2: Purge Docker system
echo -e "\n\033[1;33m[2/8] Purging Docker system (images, containers, cache)...\033[0m"
docker system prune -af --volumes > /dev/null 2>&1 || true
echo -e "  \033[1;32m✓ Docker system purged\033[0m"

# Step 3: Install dependencies
echo -e "\n\033[1;33m[3/8] Installing Node.js dependencies...\033[0m"

# Server dependencies
echo -e "  \033[0;90m→ Installing server dependencies...\033[0m"
cd server
npm install --silent > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo -e "  \033[1;32m✓ Server dependencies installed\033[0m"
else
    echo -e "  \033[1;31m✗ Server npm install failed\033[0m"
    exit 1
fi
cd ..

# Client dependencies
echo -e "  \033[0;90m→ Installing client dependencies...\033[0m"
cd client
npm install --silent > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo -e "  \033[1;32m✓ Client dependencies installed\033[0m"
else
    echo -e "  \033[1;31m✗ Client npm install failed\033[0m"
    exit 1
fi
cd ..

# Step 4: Build backend image
echo -e "\n\033[1;33m[4/8] Building backend Docker image...\033[0m"
docker build -f Dockerfile.backend -t ${BACKEND_IMAGE}:latest . > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo -e "  \033[1;32m✓ Backend image built: ${BACKEND_IMAGE}:latest\033[0m"
else
    echo -e "  \033[1;31m✗ Backend build failed\033[0m"
    exit 1
fi

# Step 5: Build frontend image
if [ "$SKIP_FRONTEND" = false ]; then
    echo -e "\n\033[1;33m[5/8] Building frontend Docker image...\033[0m"
    docker build -f Dockerfile.frontend -t ${FRONTEND_IMAGE}:latest . > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo -e "  \033[1;32m✓ Frontend image built: ${FRONTEND_IMAGE}:latest\033[0m"
    else
        echo -e "  \033[1;31m✗ Frontend build failed\033[0m"
        exit 1
    fi
else
    echo -e "\n\033[1;33m[5/8] Skipping frontend build (--skip-frontend flag)\033[0m"
fi

# Step 6: Push backend to ECR
if [ "$SKIP_ECR" = false ]; then
    echo -e "\n\033[1;33m[6/8] Pushing backend to ECR...\033[0m"
    
    # Login to ECR
    echo -e "  \033[0;90m→ Logging into ECR...\033[0m"
    aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REPO > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo -e "  \033[1;32m✓ ECR login successful\033[0m"
    else
        echo -e "  \033[1;31m✗ ECR login failed - check AWS credentials\033[0m"
        exit 1
    fi
    
    # Tag image
    echo -e "  \033[0;90m→ Tagging image...\033[0m"
    docker tag ${BACKEND_IMAGE}:latest ${ECR_REPO}:backend-latest
    if [ $? -eq 0 ]; then
        echo -e "  \033[1;32m✓ Image tagged\033[0m"
    else
        echo -e "  \033[1;31m✗ Image tagging failed\033[0m"
        exit 1
    fi
    
    # Push to ECR
    echo -e "  \033[0;90m→ Pushing to ECR (this may take a few minutes)...\033[0m"
    docker push ${ECR_REPO}:backend-latest > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo -e "  \033[1;32m✓ Backend pushed to ECR: ${ECR_REPO}:backend-latest\033[0m"
    else
        echo -e "  \033[1;31m✗ ECR push failed\033[0m"
        exit 1
    fi
else
    echo -e "\n\033[1;33m[6/8] Skipping ECR push (--skip-ecr flag)\033[0m"
fi

# Step 7: Deploy frontend
if [ "$SKIP_FRONTEND" = false ]; then
    echo -e "\n\033[1;33m[7/8] Deploying frontend...\033[0m"
    
    if [ -n "$EC2_IP" ]; then
        # Deploy to EC2
        echo -e "  \033[0;90m→ Deploying to EC2 instance: $EC2_IP\033[0m"
        
        echo -e "  \033[0;90m→ Uploading files to EC2...\033[0m"
        scp Dockerfile.frontend ubuntu@${EC2_IP}:~/ > /dev/null 2>&1
        scp docker-compose-frontend-ec2.yml ubuntu@${EC2_IP}:~/docker-compose.yml > /dev/null 2>&1
        scp -r client ubuntu@${EC2_IP}:~/ > /dev/null 2>&1
        echo -e "  \033[1;32m✓ Files uploaded to EC2\033[0m"
        
        echo -e "  \033[0;90m→ Building and starting on EC2...\033[0m"
        echo -e "\n  \033[1;36mRun these commands on EC2:\033[0m"
        echo "    ssh ubuntu@$EC2_IP"
        echo "    cd ~"
        echo "    docker-compose down"
        echo "    docker-compose build --no-cache"
        echo "    docker-compose up -d"
        echo "    docker-compose logs -f"
    else
        # Run locally with docker-compose
        echo -e "  \033[0;90m→ Starting frontend container locally...\033[0m"
        
        if [ -f "docker-compose-frontend-ec2.yml" ]; then
            docker-compose -f docker-compose-frontend-ec2.yml up -d > /dev/null 2>&1
            if [ $? -eq 0 ]; then
                echo -e "  \033[1;32m✓ Frontend container started locally\033[0m"
                echo -e "  \033[1;36m→ Access at: http://localhost\033[0m"
            else
                echo -e "  \033[1;31m✗ Failed to start frontend container\033[0m"
                exit 1
            fi
        else
            echo -e "  \033[1;33m⚠ docker-compose-frontend-ec2.yml not found\033[0m"
            echo -e "  \033[1;36m→ Run manually: docker run -d -p 80:80 ${FRONTEND_IMAGE}:latest\033[0m"
        fi
    fi
else
    echo -e "\n\033[1;33m[7/8] Skipping frontend deployment (--skip-frontend flag)\033[0m"
fi

# Step 8: Summary
echo -e "\n\033[1;33m[8/8] Deployment Summary\033[0m"
echo "========================================"

if [ "$SKIP_ECR" = false ]; then
    echo "Backend:  Built and pushed to ECR"
else
    echo "Backend:  Built locally (not pushed to ECR)"
fi

if [ "$SKIP_FRONTEND" = false ]; then
    if [ -n "$EC2_IP" ]; then
        echo "Frontend: Files uploaded to EC2"
    else
        echo "Frontend: Running locally"
    fi
else
    echo "Frontend: Skipped"
fi

if [ "$SKIP_ECR" = false ]; then
    echo -e "\n\033[1;33mNext steps:\033[0m"
    echo "  1. Go to ECS Console"
    echo "  2. Update service → Force new deployment"
    echo "  3. Wait 2-3 minutes for tasks to restart"
    echo "  4. Check logs in CloudWatch"
fi

if [ "$SKIP_FRONTEND" = false ] && [ -z "$EC2_IP" ]; then
    echo -e "\n\033[1;33mLocal frontend:\033[0m"
    echo -e "  URL: \033[1;36mhttp://localhost\033[0m"
    echo "  Logs: docker-compose -f docker-compose-frontend-ec2.yml logs -f"
    echo "  Stop: docker-compose -f docker-compose-frontend-ec2.yml down"
fi

echo -e "\n\033[1;32m✓ Deployment complete!\033[0m"
echo -e "========================================\n"
