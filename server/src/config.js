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

  // Overlay secrets from Secrets Manager
  const secretPromises = []
  
  // JWT secret
  const jwtSecretName = getEnv('SECRETS_JWT_SECRET_NAME', '')
  if (jwtSecretName) {
    secretPromises.push(
      getSecretValue(jwtSecretName, { fallback: null })
        .then(val => {
          if (val) {
            cfg.jwtSecret = parseSecretJson(val, 'jwtSecret', val)
            console.log('✓ JWT secret loaded from Secrets Manager')
          } else {
            console.warn('JWT secret not loaded (using fallback)')
          }
        })
        .catch(() => console.warn('Failed to load JWT secret from Secrets Manager'))
    )
  }

  // Cognito client secret
  const cognitoSecretName = getEnv('SECRETS_COGNITO_CLIENT_SECRET_NAME', '')
  if (cognitoSecretName) {
    secretPromises.push(
      getSecretValue(cognitoSecretName, { fallback: null })
        .then(val => {
          if (val) {
            cfg.cognito.clientSecret = parseSecretJson(val, 'clientSecret', val)
            console.log('✓ Cognito client secret loaded from Secrets Manager')
          } else {
            console.warn('Cognito client secret not loaded (no secret value)')
          }
        })
        .catch(() => console.warn('Failed to load Cognito secret from Secrets Manager'))
    )
  }

  // Database credentials (for future DynamoDB or RDS)
  const dbSecretName = getEnv('SECRETS_DATABASE_NAME', '')
  if (dbSecretName) {
    secretPromises.push(
      getSecretValue(dbSecretName, { fallback: null })
        .then(val => {
          if (val) {
            const parsed = parseSecretJson(val, null, {})
            cfg.database = {
              accessKeyId: parsed.accessKeyId || '',
              secretAccessKey: parsed.secretAccessKey || '',
              region: parsed.region || cfg.region
            }
            console.log('✓ Database credentials loaded from Secrets Manager')
          } else {
            console.warn('Database credentials secret empty or missing')
          }
        })
        .catch(() => console.warn('Failed to load database credentials from Secrets Manager'))
    )
  }

  // External API keys (for future integrations)
  const apiSecretName = getEnv('SECRETS_EXTERNAL_APIS_NAME', '')
  if (apiSecretName) {
    secretPromises.push(
      getSecretValue(apiSecretName, { fallback: null })
        .then(val => {
          if (val) {
            const parsed = parseSecretJson(val, null, {})
            cfg.externalApis = {
              ffmpegApiKey: parsed.ffmpegApiKey || '',
              transcriptionApiKey: parsed.transcriptionApiKey || '',
              notificationWebhook: parsed.notificationWebhook || ''
            }
            console.log('✓ External API credentials loaded from Secrets Manager')
          } else {
            console.warn('External API credentials secret empty or missing')
          }
        })
        .catch(() => console.warn('Failed to load external API credentials from Secrets Manager'))
    )
  }

  // Wait for all secret loading to complete
  if (secretPromises.length > 0) {
    console.log(`Loading ${secretPromises.length} secrets from Secrets Manager...`)
    await Promise.allSettled(secretPromises)
  }

  // Feature flags (must be set after secrets are loaded)
  cfg.features = {
    useCognito: !!(cfg.cognito.userPoolId && cfg.cognito.clientId),
    useS3: !!cfg.s3.bucket,
    useSecretsManager: secretPromises.length > 0
  }

  console.log('Configuration used this session:', {
    cognito: cfg.features.useCognito,
    s3: cfg.features.useS3,
    secrets: cfg.features.useSecretsManager,
    region: cfg.region
  })

  return cfg
}

export default await loadConfig()
