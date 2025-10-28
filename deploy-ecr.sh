#!/bin/bash
# ECR-only deployment - build backend and push to ECR

set -e

# Configuration
AWS_REGION="ap-southeast-2"
AWS_ACCOUNT="901444280953"
ECR_REPO="$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/n11590041-video-editor"
BACKEND_IMAGE="video-editor-backend"

# Parse arguments
NO_BUILD=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --no-build)
            NO_BUILD=true
            shift
            ;;
        --help|-h)
            cat << EOF
Backend ECR Deployment Script

Usage:
    ./deploy-ecr.sh [OPTIONS]

Options:
    --no-build      Skip building the Docker image (push existing image)
    --help, -h      Show this help message

Examples:
    ./deploy-ecr.sh              # Build and push
    ./deploy-ecr.sh --no-build   # Push only

EOF
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo -e "\n=== Backend ECR Deployment ==="

if [ "$NO_BUILD" = false ]; then
    # Build backend
    echo -e "\n\033[1;33m[1/3] Building backend image...\033[0m"
    docker build -f Dockerfile.backend -t ${BACKEND_IMAGE}:latest .
    if [ $? -eq 0 ]; then
        echo -e "  \033[1;32m✓ Backend built successfully\033[0m"
    else
        echo -e "  \033[1;31m✗ Build failed\033[0m"
        exit 1
    fi
else
    echo -e "\n\033[1;33m[1/3] Skipping build (--no-build flag)\033[0m"
fi

# Login to ECR
echo -e "\n\033[1;33m[2/3] Logging into ECR...\033[0m"
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REPO > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo -e "  \033[1;32m✓ ECR login successful\033[0m"
else
    echo -e "  \033[1;31m✗ ECR login failed - check AWS credentials\033[0m"
    exit 1
fi

# Tag and push
echo -e "\n\033[1;33m[3/3] Pushing to ECR...\033[0m"
echo -e "  \033[0;90m→ Tagging image...\033[0m"
docker tag ${BACKEND_IMAGE}:latest ${ECR_REPO}:backend-latest

echo -e "  \033[0;90m→ Pushing (this may take 2-3 minutes)...\033[0m"
docker push ${ECR_REPO}:backend-latest
if [ $? -eq 0 ]; then
    echo -e "  \033[1;32m✓ Pushed to: ${ECR_REPO}:backend-latest\033[0m"
else
    echo -e "  \033[1;31m✗ Push failed\033[0m"
    exit 1
fi

echo -e "\n\033[1;32m✓ ECR deployment complete!\033[0m"
echo -e "\n\033[1;33mNext steps:\033[0m"
echo "  1. Go to ECS Console"
echo "  2. Services → Update service"
echo "  3. Check 'Force new deployment'"
echo "  4. Click Update"
echo "  5. Monitor tasks in CloudWatch Logs"
echo ""
