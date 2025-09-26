#!/usr/bin/env bash
#
# Deploy DynamoDB table for CAB432 Video Editor
# Usage: ./deploy-dynamodb.sh [QUT_USERNAME] [ENVIRONMENT]
#

set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

QUT_USERNAME=${1:-n11590041}
ENVIRONMENT=${2:-prod}
STACK_NAME="${QUT_USERNAME}-video-editor-dynamodb"

echo " Deploying DynamoDB table for Video Editor"
echo "============================================="
echo "QUT Username: $QUT_USERNAME"
echo "Environment: $ENVIRONMENT"
echo "Stack Name: $STACK_NAME"
echo "AWS Region: $(aws configure get region || echo 'ap-southeast-2')"
echo ""

# Check if AWS CLI is configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo " AWS CLI not configured or no valid credentials found"
    echo "   Please run 'aws configure' or set AWS credentials"
    exit 1
fi

# Deploy CloudFormation stack
echo " Deploying CloudFormation stack..."
aws cloudformation deploy \
    --template-file "$PROJECT_ROOT/aws/dynamodb-table.yaml" \
    --stack-name "$STACK_NAME" \
    --parameter-overrides \
        QUTUsername="$QUT_USERNAME" \
        Environment="$ENVIRONMENT" \
    --capabilities CAPABILITY_IAM \
    --no-fail-on-empty-changeset

# Get stack outputs
echo ""
echo " Stack Outputs:"
echo "================="
aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].Outputs[*].{Key:OutputKey,Value:OutputValue}' \
    --output table

# Get table information
TABLE_NAME=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].Outputs[?OutputKey==`TableName`].OutputValue' \
    --output text)

echo ""
echo "DynamoDB table deployed successfully!"
echo "======================================="
echo "Table Name: $TABLE_NAME"
echo "Console URL: https://console.aws.amazon.com/dynamodb/home?region=$(aws configure get region)#tables:selected=$TABLE_NAME"
echo ""
echo "Next steps:"
echo "1. Update your .env file with DYNAMODB_TABLE_NAME=$TABLE_NAME"
echo "2. Run the migration script: node server/scripts/migrate-to-dynamodb.js"
echo "3. Test the application with DynamoDB storage"