
# Get current date in ISO format
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")
DEPLOY_DATE=$(date +"%Y-%m-%d %H:%M")

# Get git commit hash (short) if available
GIT_HASH=""
if git rev-parse --short HEAD >/dev/null 2>&1; then
    GIT_HASH=$(git rev-parse --short HEAD)
fi

echo "Updating version information..."
echo "Build time: $BUILD_TIME"
echo "Git hash: ${GIT_HASH:-'N/A'}"

# Update server package.json version with build info
cd server
npm version patch --no-git-tag-version

# Get the new version number
NEW_VERSION=$(node -p "require('./package.json').version")
echo "New version: $NEW_VERSION"

# Update client package.json to match
cd ../client
sed -i "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" package.json

# Create a build info file that the server can read
cd ../server
cat > build-info.json << EOF
{
  "version": "$NEW_VERSION",
  "buildTime": "$BUILD_TIME",
  "deployDate": "$DEPLOY_DATE",
  "gitHash": "$GIT_HASH"
}
EOF