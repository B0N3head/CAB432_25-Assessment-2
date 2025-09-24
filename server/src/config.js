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
  } catch {
    return fallback
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
  }
  // S3
  cfg.s3 = {
    bucket: getEnv('S3_BUCKET', ''),
    uploadsPrefix: getEnv('S3_UPLOADS_PREFIX', 'uploads/'),
    outputsPrefix: getEnv('S3_OUTPUTS_PREFIX', 'outputs/'),
    thumbsPrefix: getEnv('S3_THUMBS_PREFIX', 'thumbnails/'),
  }
  // Memcached
  cfg.cache = {
    memcachedUrl: getEnv('MEMCACHED_URL', ''),
    enabled: !!getEnv('MEMCACHED_URL', '')
  }
  // Feature flags
  cfg.features = {
    useCognito: !!(cfg.cognito.userPoolId && cfg.cognito.clientId),
    useS3: !!cfg.s3.bucket,
  }
  // JWT secret fallback (dev only)
  cfg.jwtSecret = getEnv('JWT_SECRET', 'devsecret')

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

  // Overlay JWT secret from Secrets Manager (optional)
  try {
    const secretName = getEnv('SECRETS_JWT_SECRET_NAME', '') || null
    if (secretName) {
      const val = await getSecretValue(secretName, { fallback: cfg.jwtSecret })
      if (val) cfg.jwtSecret = JSON.parseCatch?.(val) ?? val
    }
  } catch {}
  return cfg
}

export default await loadConfig()
