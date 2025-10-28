#!/bin/bash
# Quick Start - Deploy Backend to Production
# Run this on your Linux server after git pull

echo "=========================================="
echo "Video Editor - Quick Production Deploy"
echo "=========================================="
echo ""

# Check if running on Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo "⚠️  Warning: This script is designed for Linux servers"
    echo "   For Windows, use deploy-full.ps1 instead"
    echo ""
fi

# Make scripts executable
echo "Making scripts executable..."
chmod +x *.sh
echo "✓ Scripts are now executable"
echo ""

# Ask user what they want to do
echo "What would you like to do?"
echo ""
echo "  1) Full deployment (backend + frontend locally)"
echo "  2) Backend only (push to ECR)"
echo "  3) Local test only (no ECR push)"
echo "  4) Verify build first"
echo ""
read -p "Enter choice [1-4]: " choice

case $choice in
    1)
        echo ""
        echo "Running full deployment..."
        ./deploy-full.sh
        ;;
    2)
        echo ""
        echo "Deploying backend to ECR..."
        ./deploy-ecr.sh
        ;;
    3)
        echo ""
        echo "Building for local testing..."
        ./quick-deploy.sh
        ;;
    4)
        echo ""
        echo "Verifying build..."
        ./verify-build.sh
        if [ $? -eq 0 ]; then
            echo ""
            echo "✓ Build verification passed!"
            echo "  Run this script again to deploy."
        fi
        ;;
    *)
        echo ""
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac

echo ""
echo "=========================================="
echo "Done!"
echo "=========================================="
