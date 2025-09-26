#!/usr/bin/env node

/**
 * Test script to verify AWS Secrets Manager integration
 * Usage: node test-secrets.js
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

const SECRET_NAME = 'n11590041-video-editor'
const AWS_REGION = 'ap-southeast-2'

console.log('Testing AWS Secrets Manager Integration')
console.log('==========================================')
console.log(`Secret Name: ${SECRET_NAME}`)
console.log(`AWS Region: ${AWS_REGION}`)
console.log('')

async function testSecretsManager() {
  try {
    // Create Secrets Manager client
    console.log('Creating Secrets Manager client...')
    const client = new SecretsManagerClient({
      region: AWS_REGION
    })
    
    console.log('Retrieving secret from AWS Secrets Manager...')
    
    // Get secret value
    const response = await client.send(
      new GetSecretValueCommand({
        SecretId: SECRET_NAME,
        VersionStage: "AWSCURRENT"
      })
    )
    
    if (response.SecretString) {
      console.log('Successfully retrieved secret!')
      
      try {
        const secrets = JSON.parse(response.SecretString)
        console.log('')
        console.log('Secret Contents:')
        console.log('===================')
        
        // Display configuration (masking sensitive values)
        const configKeys = [
          'jwtSecret',
          'cognitoClientSecret', 
          'cognitoUserPoolId',
          'cognitoClientId',
          'cognitoDomain',
          'cognitoRedirectUri',
          's3Bucket',
          'dynamodbTableName',
          'memcachedUrl',
          'awsAccessKeyId',
          'awsSecretAccessKey'
        ]
        
        configKeys.forEach(key => {
          if (secrets.hasOwnProperty(key)) {
            const value = secrets[key]
            const maskedValue = ['jwtSecret', 'cognitoClientSecret', 'awsSecretAccessKey'].includes(key) && value
              ? `${value.substring(0, 4)}...${value.substring(value.length - 4)}`
              : value
            
            const status = value ? '✓' : '○'
            console.log(`  ${status} ${key}: ${maskedValue || '(empty)'}`)
          } else {
            console.log(`  ○ ${key}: (not set)`)
          }
        })
        
        console.log('')
        console.log('Configuration Validation:')
        console.log('============================')
        
        // Validate essential configuration
        const validations = [
          { key: 'jwtSecret', required: true, description: 'JWT signing secret' },
          { key: 's3Bucket', required: true, description: 'S3 bucket for media storage' },
          { key: 'cognitoUserPoolId', required: true, description: 'Cognito User Pool ID' },
          { key: 'cognitoClientId', required: true, description: 'Cognito Client ID' },
          { key: 'dynamodbTableName', required: false, description: 'DynamoDB table name' },
          { key: 'cognitoClientSecret', required: false, description: 'Cognito client secret' }
        ]
        
        let allValid = true
        validations.forEach(({ key, required, description }) => {
          const value = secrets[key]
          const isValid = required ? !!value : true
          const status = isValid ? 'Y' : 'N'
          const requirement = required ? 'REQUIRED' : 'optional'
          
          console.log(`${status} ${description} (${requirement})`)
          
          if (required && !value) {
            allValid = false
          }
        })
        
        console.log('')
        if (allValid) {
          console.log('All required configuration is present!')
          console.log('Your application should start successfully with this configuration.')
        } else {
          console.log('Some required configuration is missing.')
          console.log('Please update your secret with the missing values.')
        }
        
      } catch (parseError) {
        console.error('Failed to parse secret as JSON:', parseError.message)
        console.log('Raw secret value (first 100 chars):', response.SecretString.substring(0, 100) + '...')
        console.log('')
        console.log('Make sure your secret is valid JSON format.')
      }
      
    } else {
      console.error('No SecretString found in response')
    }
    
  } catch (error) {
    console.error('Failed to retrieve secret:', error.message)
    console.log('')
    console.log('Troubleshooting Steps:')
    console.log('1. Check if the secret exists in AWS Secrets Manager')
    console.log('2. Verify IAM permissions for secretsmanager:GetSecretValue')  
    console.log('3. Confirm you are in the correct AWS region (ap-southeast-2)')
    console.log('4. Test AWS credentials with: aws sts get-caller-identity')
  }
}

// Run the test
testSecretsManager().catch(console.error)