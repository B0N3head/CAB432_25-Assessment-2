import dotenv from 'dotenv'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

dotenv.config()

const awsRegion = process.env.AWS_REGION || 'ap-southeast-2'

// Load configuration from AWS Secrets Manager
export async function loadConfig() {
  const cfg = {}
  cfg.region = awsRegion
  
  // Initialize with defaults
  cfg.cognito = {}
  cfg.s3 = {
    uploadsPrefix: 'media/uploads/',
    outputsPrefix: 'media/outputs/',
    thumbsPrefix: 'media/thumbnails/',
  }
  cfg.cache = { enabled: false }
  cfg.database = {}
  cfg.jwtSecret = 'devsecret'
  cfg.aws = {
    accessKeyId: '',
    secretAccessKey: ''
  }
  
  // Load secrets from AWS Secrets Manager
  const secretName = 'n11590041-video-editor'
  
  try {
    console.log('Loading configuration from Secrets Manager...')
    const client = new SecretsManagerClient({ region: awsRegion })
    const command = new GetSecretValueCommand({ SecretId: secretName })
    const response = await client.send(command)
    
    if (response.SecretString) {
      const secretData = JSON.parse(response.SecretString)
      
      // Load all configuration from secrets
      cfg.cognito.userPoolId = secretData.COGNITO_USER_POOL_ID
      cfg.cognito.clientId = secretData.COGNITO_CLIENT_ID
      cfg.cognito.domain = secretData.COGNITO_DOMAIN
      cfg.cognito.clientSecret = secretData.COGNITO_CLIENT_SECRET
      cfg.cognito.redirectUri = secretData.COGNITO_REDIRECT_URI
      
      cfg.s3.bucket = secretData.S3_BUCKET
      cfg.jwtSecret = secretData.JWT_SECRET
      cfg.database.tableName = secretData.DYNAMODB_TABLE_NAME
      
      if (secretData.MEMCACHED_URL) {
        cfg.cache.memcachedUrl = secretData.MEMCACHED_URL
        cfg.cache.enabled = true
      }
      
      console.log('Configuration loaded from Secrets Manager successfully')
    }
  } catch (error) {
    console.error('Failed to load from Secrets Manager:', error.message)
    throw new Error(`Could not load configuration: ${error.message}`)
  }
  
  // Feature flags (must be set after secrets are loaded)
  cfg.features = {
    useCognito: !!(cfg.cognito.userPoolId && cfg.cognito.clientId),
    useS3: !!cfg.s3.bucket,
    useSecretsManager: true,
    useDynamoDB: !!(cfg.database.tableName)
  }

  console.log('Configuration Summary:', {
    cognito: cfg.features.useCognito,
    s3: cfg.features.useS3,
    dynamodb: cfg.features.useDynamoDB,
    secrets: cfg.features.useSecretsManager,
    region: cfg.region
  })
  
  return cfg
}

export default await loadConfig()
