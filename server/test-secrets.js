// Test script to verify AWS Secrets Manager configuration
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

const awsRegion = 'ap-southeast-2'
const secretName = 'n11590041-video-editor'

async function testSecretsManager() {
  console.log('Testing AWS Secrets Manager configuration...')
  console.log(`Region: ${awsRegion}`)
  console.log(`Secret Name: ${secretName}`)
  
  try {
    // Simple client initialization - exactly like AWS tutorial
    const client = new SecretsManagerClient({ region: awsRegion })
    const command = new GetSecretValueCommand({ SecretId: secretName })
    
    console.log('Sending request to Secrets Manager...')
    const response = await client.send(command)
    
    if (response.SecretString) {
      console.log('✅ SUCCESS: Secret retrieved successfully')
      const secretData = JSON.parse(response.SecretString)
      console.log('Available keys:', Object.keys(secretData))
    } else {
      console.log('❌ ERROR: No secret string returned')
    }
    
  } catch (error) {
    console.log('❌ ERROR:', error.message)
    console.log('Error code:', error.name)
    
    if (error.message.includes('security token')) {
      console.log('\n🔍 DIAGNOSIS: This appears to be an IAM permissions issue.')
      console.log('Make sure your EC2 instance has the CAB432-Instance-Role with:')
      console.log('- secretsmanager:GetSecretValue permission')
      console.log('- For resource: arn:aws:secretsmanager:ap-southeast-2:*:secret:n11590041-video-editor*')
    }
  }
}

testSecretsManager()