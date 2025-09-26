import dotenv from 'dotenv'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

dotenv.config()

// Simple cached config loader that prefers AWS SSM/Secrets when configured, with .env fallbacks
const cache = { params: new Map(), secrets: new Map() }

function getEnv(name, fallback) {
  return process.env[name] ?? fallback
}

const awsRegion = getEnv('AWS_REGION', getEnv('AWS_DEFAULT_REGION', 'ap-southeast-2'))
let ssm, secrets
function getSSM() {
  if (!ssm) ssm = new SSMClient({ region: awsRegion })
  return ssm
}
function getSecrets() {
  if (!secrets) secrets = new SecretsManagerClient({ region: awsRegion })
  return secrets
}

export async function getParameter(name, { withDecryption = false, fallback } = {}) {
  if (!name) return fallback
  if (cache.params.has(name)) return cache.params.get(name)
  try {
    const { Parameter } = await getSSM().send(new GetParameterCommand({ Name: name, WithDecryption: withDecryption }))
    const val = Parameter?.Value ?? fallback
    cache.params.set(name, val)
    return val
  } catch {
    return fallback
  }
}

export async function getSecretValue(name, { fallback } = {}) {
  if (!name) return fallback
  if (cache.secrets.has(name)) return cache.secrets.get(name)
  try {
    const res = await getSecrets().send(new GetSecretValueCommand({ SecretId: name }))
    const val = res.SecretString || (res.SecretBinary ? Buffer.from(res.SecretBinary, 'base64').toString('utf8') : null)
    cache.secrets.set(name, val ?? fallback)
    return val ?? fallback
  } catch (e) {
    console.warn(`Failed to retrieve secret ${name}:`, e.message)
    return fallback
  }
}

// Helper to parse JSON secrets safely
function parseSecretJson(secretString, key, fallback) {
  try {
    const parsed = JSON.parse(secretString)
    return parsed[key] ?? fallback
  } catch {
    // If not JSON, return the raw string (backwards compatibility)
    return secretString ?? fallback
  }
}

// Public config used by server; read once on startup and keep in memory
export async function loadConfig() {
  const cfg = {}
  cfg.region = awsRegion
  // Cognito
  cfg.cognito = {
    userPoolId: getEnv('COGNITO_USER_POOL_ID', ''),
    clientId: getEnv('COGNITO_CLIENT_ID', ''),
    domain: getEnv('COGNITO_DOMAIN', ''),
    clientSecret: getEnv('COGNITO_CLIENT_SECRET', ''),
    // Optional explicit redirect URI (helps avoid redirect_mismatch if provided)
    redirectUri: getEnv('COGNITO_REDIRECT_URI', '')
  }
  // S3
  cfg.s3 = {
    bucket: getEnv('S3_BUCKET', ''),
    uploadsPrefix: getEnv('S3_UPLOADS_PREFIX', 'media/uploads/'),
    outputsPrefix: getEnv('S3_OUTPUTS_PREFIX', 'media/outputs/'),
    thumbsPrefix: getEnv('S3_THUMBS_PREFIX', 'media/thumbnails/'),
  }
  // Memcached
  cfg.cache = {
    memcachedUrl: getEnv('MEMCACHED_URL', ''),
    enabled: !!getEnv('MEMCACHED_URL', '')
  }
  // JWT secret fallback (dev only)
  cfg.jwtSecret = getEnv('JWT_SECRET', 'devsecret')
  
  // AWS credentials (only for local development)
  cfg.aws = {
    accessKeyId: getEnv('AWS_ACCESS_KEY_ID', ''),
    secretAccessKey: getEnv('AWS_SECRET_ACCESS_KEY', '')
  }
  
  // Initialize optional configs
  cfg.database = cfg.database || {}
  cfg.externalApis = cfg.externalApis || {}

  // Overlay from SSM Parameter Store if available (non-fatal on failure)
  try {
    const pfx = getEnv('SSM_PARAM_PREFIX', '/app/video-editor')
    const [userPoolId, clientId, domain, bucket, memUrl] = await Promise.all([
      getParameter(`${pfx}/cognito/userPoolId`, { fallback: cfg.cognito.userPoolId }),
      getParameter(`${pfx}/cognito/clientId`, { fallback: cfg.cognito.clientId }),
      getParameter(`${pfx}/cognito/domain`, { fallback: cfg.cognito.domain }),
      getParameter(`${pfx}/s3/bucket`, { fallback: cfg.s3.bucket }),
      getParameter(`${pfx}/cache/memcachedUrl`, { fallback: cfg.cache.memcachedUrl })
    ])
    cfg.cognito.userPoolId = userPoolId || cfg.cognito.userPoolId
    cfg.cognito.clientId = clientId || cfg.cognito.clientId
    cfg.cognito.domain = domain || cfg.cognito.domain
    cfg.s3.bucket = bucket || cfg.s3.bucket
    cfg.cache.memcachedUrl = memUrl || cfg.cache.memcachedUrl
    cfg.cache.enabled = !!cfg.cache.memcachedUrl
  } catch {}

  // Load centralized secret from AWS Secrets Manager
  const secretName = getEnv('SECRET_NAME', 'n11590041-video-editor')
  console.log(`Loading configuration from AWS Secrets Manager: ${secretName}`)
  
  try {
    const secretValue = await getSecretValue(secretName, { fallback: null })
    
    if (secretValue) {
      console.log('Successfully retrieved secret from AWS Secrets Manager')
      
      try {
        const secrets = JSON.parse(secretValue)
        console.log('Parsing configuration from secret...')
        
        // Override configuration with values from Secrets Manager
        if (secrets.jwtSecret) {
          cfg.jwtSecret = secrets.jwtSecret
          console.log('    JWT secret loaded')
        }
        
        // Cognito configuration
        if (secrets.cognitoClientSecret) {
          cfg.cognito.clientSecret = secrets.cognitoClientSecret
          console.log('  Cognito client secret loaded')
        }
        if (secrets.cognitoUserPoolId) {
          cfg.cognito.userPoolId = secrets.cognitoUserPoolId
          console.log('  Cognito User Pool ID loaded')
        }
        if (secrets.cognitoClientId) {
          cfg.cognito.clientId = secrets.cognitoClientId
          console.log('  Cognito Client ID loaded')
        }
        if (secrets.cognitoDomain) {
          cfg.cognito.domain = secrets.cognitoDomain
          console.log('  Cognito Domain loaded')
        }
        if (secrets.cognitoRedirectUri) {
          cfg.cognito.redirectUri = secrets.cognitoRedirectUri
          console.log('  Cognito Redirect URI loaded')
        }
        
        // S3 configuration
        if (secrets.s3Bucket) {
          cfg.s3.bucket = secrets.s3Bucket
          console.log('  S3 Bucket loaded')
        }
        
        // DynamoDB configuration  
        if (secrets.dynamodbTableName) {
          cfg.database.tableName = secrets.dynamodbTableName
          console.log('  DynamoDB Table Name loaded')
        }
        
        // AWS credentials (only if provided in secret)
        if (secrets.awsAccessKeyId && secrets.awsSecretAccessKey) {
          cfg.aws.accessKeyId = secrets.awsAccessKeyId
          cfg.aws.secretAccessKey = secrets.awsSecretAccessKey
          console.log('  AWS credentials loaded from secret')
        }
        
        // Memcached/ElastiCache configuration
        if (secrets.memcachedUrl) {
          cfg.cache.memcachedUrl = secrets.memcachedUrl
          cfg.cache.enabled = true
          console.log('  Memcached URL loaded')
        }
        
        console.log('All secrets loaded successfully from AWS Secrets Manager')
        
      } catch (parseError) {
        console.error('Failed to parse secret JSON:', parseError.message)
        console.log('Using fallback configuration from environment variables')
      }
    } else {
      console.warn('No secret found, using environment variable fallbacks')
    }
    
  } catch (secretError) {
    console.error('Failed to retrieve secret from AWS Secrets Manager:', secretError.message)
    console.log('Using fallback configuration from environment variables')
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
    region: cfg.region,
    secretName: secretName
  })

  return cfg
}

export default await loadConfig()
