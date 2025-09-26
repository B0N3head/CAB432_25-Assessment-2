# Deploy DynamoDB table for CAB432 Video Editor
# Usage: .\deploy-dynamodb.ps1 [-QUTUsername "n11590041"] [-Environment "prod"]

param(
    [string]$QUTUsername = "n11590041",
    [string]$Environment = "prod"
)

$StackName = "$QUTUsername-video-editor-dynamodb"

Write-Host "🚀 Deploying DynamoDB table for Video Editor" -ForegroundColor Green
Write-Host "============================================="
Write-Host "QUT Username: $QUTUsername"
Write-Host "Environment: $Environment"
Write-Host "Stack Name: $StackName"

# Get current AWS region
try {
    $Region = aws configure get region
    if (-not $Region) { $Region = "ap-southeast-2" }
    Write-Host "AWS Region: $Region"
} catch {
    $Region = "ap-southeast-2"
    Write-Host "AWS Region: $Region (default)"
}

Write-Host ""

# Check if AWS CLI is configured
try {
    $CallerIdentity = aws sts get-caller-identity 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "AWS CLI not configured"
    }
} catch {
    Write-Host "❌ AWS CLI not configured or no valid credentials found" -ForegroundColor Red
    Write-Host "   Please run 'aws configure' or set AWS credentials"
    exit 1
}

# Deploy CloudFormation stack
Write-Host "📝 Deploying CloudFormation stack..."
aws cloudformation deploy `
    --template-file aws/dynamodb-table.yaml `
    --stack-name "$StackName" `
    --parameter-overrides `
        "QUTUsername=$QUTUsername" `
        "Environment=$Environment" `
    --capabilities CAPABILITY_IAM `
    --no-fail-on-empty-changeset

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ CloudFormation deployment failed" -ForegroundColor Red
    exit 1
}

# Get stack outputs
Write-Host ""
Write-Host "📋 Stack Outputs:" -ForegroundColor Cyan
Write-Host "================="
aws cloudformation describe-stacks `
    --stack-name "$StackName" `
    --query 'Stacks[0].Outputs[*].{Key:OutputKey,Value:OutputValue}' `
    --output table

# Get table information
$TableName = aws cloudformation describe-stacks `
    --stack-name "$StackName" `
    --query 'Stacks[0].Outputs[?OutputKey==`TableName`].OutputValue' `
    --output text

Write-Host ""
Write-Host "✅ DynamoDB table deployed successfully!" -ForegroundColor Green
Write-Host "======================================="
Write-Host "Table Name: $TableName"
Write-Host "Console URL: https://console.aws.amazon.com/dynamodb/home?region=$Region#tables:selected=$TableName"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Update your .env file with DYNAMODB_TABLE_NAME=$TableName"
Write-Host "2. Run the migration script: node server/scripts/migrate-to-dynamodb.js"
Write-Host "3. Test the application with DynamoDB storage"