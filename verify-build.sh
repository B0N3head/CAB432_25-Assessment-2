#!/bin/bash
# Verify all files have correct syntax before deployment

echo -e "\n=== Pre-Deployment Verification ==="

ALL_PASSED=true

# Check server files
echo -e "\n\033[1;33m[1/3] Checking server files...\033[0m"
SERVER_FILES=(
    "server/src/index.js"
    "server/src/worker.js"
    "server/src/queue.js"
    "server/src/routes.js"
    "server/src/s3.js"
    "server/src/storage.js"
    "server/src/video.js"
    "server/src/config.js"
)

for file in "${SERVER_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -n "  → Checking $file..."
        if node --check "$file" 2>/dev/null; then
            echo -e " \033[1;32m✓\033[0m"
        else
            echo -e " \033[1;31m✗\033[0m"
            ALL_PASSED=false
        fi
    else
        echo -e "  \033[1;33m⚠ $file not found\033[0m"
    fi
done

# Check Dockerfiles
echo -e "\n\033[1;33m[2/3] Checking Dockerfiles...\033[0m"
DOCKERFILES=("Dockerfile.backend" "Dockerfile.frontend")

for dockerfile in "${DOCKERFILES[@]}"; do
    if [ -f "$dockerfile" ]; then
        echo -e "  \033[1;32m✓ $dockerfile exists\033[0m"
    else
        echo -e "  \033[1;31m✗ $dockerfile missing\033[0m"
        ALL_PASSED=false
    fi
done

# Check package.json files
echo -e "\n\033[1;33m[3/3] Checking package.json dependencies...\033[0m"

echo -n "  → Checking server/package.json..."
if [ -f "server/package.json" ]; then
    REQUIRED_DEPS=("@aws-sdk/client-sqs" "@aws-sdk/client-s3" "@aws-sdk/client-dynamodb" "express")
    MISSING_DEPS=()
    
    for dep in "${REQUIRED_DEPS[@]}"; do
        if ! grep -q "\"$dep\"" server/package.json; then
            MISSING_DEPS+=("$dep")
        fi
    done
    
    if [ ${#MISSING_DEPS[@]} -eq 0 ]; then
        echo -e " \033[1;32m✓\033[0m"
    else
        echo -e " \033[1;31m✗ Missing: ${MISSING_DEPS[*]}\033[0m"
        ALL_PASSED=false
    fi
else
    echo -e " \033[1;31m✗ Not found\033[0m"
    ALL_PASSED=false
fi

echo -n "  → Checking client/package.json..."
if [ -f "client/package.json" ]; then
    echo -e " \033[1;32m✓\033[0m"
else
    echo -e " \033[1;31m✗ Not found\033[0m"
    ALL_PASSED=false
fi

# Summary
echo -e "\n================================"
if [ "$ALL_PASSED" = true ]; then
    echo -e "\033[1;32m✓ All checks passed!\033[0m"
    echo -e "\n\033[1;33mReady to deploy. Run:\033[0m"
    echo "  ./deploy-full.sh"
    exit 0
else
    echo -e "\033[1;31m✗ Some checks failed\033[0m"
    echo -e "\n\033[1;33mFix the errors above before deploying.\033[0m"
    exit 1
fi
