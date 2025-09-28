import dotenv from 'dotenv'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm'

dotenv.config()

const awsRegion = process.env.AWS_REGION || 'ap-southeast-2'

// Load configuration from AWS Secrets Manager
export async function loadConfig() {
  const cfg = {}
  cfg.region = awsRegion
  
  // Initialize with defaults
  cfg.cognito = {}
  cfg.s3 = {
    bucket: '', // Will be loaded from Parameter Store
    uploadsPrefix: 'media/uploads/', // Will be overridden from Parameter Store
    outputsPrefix: 'media/outputs/', // Will be overridden from Parameter Store
    thumbsPrefix: 'media/thumbnails/', // Will be overridden from Parameter Store
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
      
      // Load all configuration from secrets (except S3 config which comes from Parameter Store)
      cfg.cognito.userPoolId = secretData.COGNITO_USER_POOL_ID
      cfg.cognito.clientId = secretData.COGNITO_CLIENT_ID
      cfg.cognito.domain = secretData.COGNITO_DOMAIN
      cfg.cognito.clientSecret = secretData.COGNITO_CLIENT_SECRET
      cfg.cognito.redirectUri = secretData.COGNITO_REDIRECT_URI
      
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

  // Load S3 configuration from AWS Parameter Store
  try {
    console.log('Loading S3 configuration from Parameter Store...')
    const ssmClient = new SSMClient({ region: awsRegion })
    
    // Parameter names from your AWS account
    const parameterNames = [
      '/a2group46/S3_BUCKET',
      '/a2group46/S3_UPLOADS_PREFIX',
      '/a2group46/S3_OUTPUTS_PREFIX',
      '/a2group46/S3_THUMBS_PREFIX'
    ]
    
    const getParametersCommand = new GetParametersCommand({
      Names: parameterNames,
      WithDecryption: true
    })
    
    const parametersResponse = await ssmClient.send(getParametersCommand)
    
    if (parametersResponse.Parameters) {
      const params = {}
      parametersResponse.Parameters.forEach(param => {
        const key = param.Name.split('/').pop() // Get the last part of the parameter name
        params[key] = param.Value
      })
      
      // Map parameter store values to config
      if (params.S3_BUCKET) cfg.s3.bucket = params.S3_BUCKET
      if (params.S3_UPLOADS_PREFIX) cfg.s3.uploadsPrefix = params.S3_UPLOADS_PREFIX
      if (params.S3_OUTPUTS_PREFIX) cfg.s3.outputsPrefix = params.S3_OUTPUTS_PREFIX
      if (params.S3_THUMBS_PREFIX) cfg.s3.thumbsPrefix = params.S3_THUMBS_PREFIX
      
      console.log('S3 configuration loaded from Parameter Store:', {
        bucket: cfg.s3.bucket,
        uploadsPrefix: cfg.s3.uploadsPrefix,
        outputsPrefix: cfg.s3.outputsPrefix,
        thumbsPrefix: cfg.s3.thumbsPrefix
      })
    }
    
    // Report any missing parameters
    if (parametersResponse.InvalidParameters && parametersResponse.InvalidParameters.length > 0) {
      console.warn('Missing parameters:', parametersResponse.InvalidParameters)
    }
    
  } catch (error) {
    console.error('Failed to load S3 configuration from Parameter Store:', error.message)
    // Don't throw here - fall back to defaults if Parameter Store is unavailable
    console.warn('Using default S3 configuration values')
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
