import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { router } from './routes.js'
import fs from 'fs'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

// In-memory IP tracking for temporary bans
const ipTracker = new Map() // { ip: { requests: [], suspiciousCount: 0, banUntil: null } }

// Cleanup old tracking data every 5 minutes
setInterval(() => {
  const now = Date.now()
  const fiveMinutesAgo = now - 5 * 60 * 1000
  
  for (const [ip, data] of ipTracker.entries()) {
    // Remove old requests (older than 5 minutes)
    data.requests = data.requests.filter(time => time > fiveMinutesAgo)
    
    // Remove expired bans and clean up empty entries
    if (data.banUntil && data.banUntil < now) {
      data.banUntil = null
      data.suspiciousCount = Math.max(0, data.suspiciousCount - 1)
    }
    
    if (data.requests.length === 0 && !data.banUntil && data.suspiciousCount === 0) {
      ipTracker.delete(ip)
    }
  }
}, 5 * 60 * 1000)

// Security middleware with IP banning
app.use((req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0]
  const now = Date.now()
  
  // Initialize IP tracking
  if (!ipTracker.has(clientIP)) {
    ipTracker.set(clientIP, { requests: [], suspiciousCount: 0, banUntil: null })
  }
  
  const ipData = ipTracker.get(clientIP)
  
  // Check if IP is currently banned
  if (ipData.banUntil && now < ipData.banUntil) {
    const remainingTime = Math.ceil((ipData.banUntil - now) / 1000 / 60)
    console.log(`Banned IP ${clientIP} attempted access (${remainingTime}min remaining)`)
    return res.status(429).json({ 
      error: 'Access denied', 
      message: 'IP temporarily blocked',
      retryAfter: Math.ceil((ipData.banUntil - now) / 1000)
    })
  }
  
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:")
  
  // Remove server fingerprinting
  res.removeHeader('X-Powered-By')
  
  // Track request
  ipData.requests.push(now)
  
  // Whitelist for legitimate services that should bypass security checks
  const isWhitelistedEndpoint = req.path === '/api/v1/health' || req.path === '/api/v1/version'
  const isAWSInternalIP = /^::ffff:(172\.31\.|127\.0\.0\.1|10\.|192\.168\.)/.test(clientIP) || 
                          /^(172\.31\.|127\.0\.0\.1|10\.|192\.168\.)/.test(clientIP)
  
  // Skip security checks for whitelisted endpoints from AWS internal networks
  if (isWhitelistedEndpoint && isAWSInternalIP) {
    return next()
  }
  
  // Check for suspicious User-Agent and headers (but allow legitimate monitoring)
  const userAgent = req.get('User-Agent') || ''
  
  // Allow legitimate monitoring tools and AWS health checks
  const legitimateAgents = [
    /amazon/i,
    /aws/i,
    /elb-healthchecker/i,
    /cloudfront/i,
    /route53/i,
    /health/i,
    /monitor/i,
    /check/i,
    /uptime/i,
    /pingdom/i,
    /datadog/i,
    /newrelic/i
  ]
  
  const isLegitimateAgent = legitimateAgents.some(pattern => pattern.test(userAgent))
  
  const suspiciousAgents = [
    /curl/i,
    /wget/i,
    /python/i,
    /scanner/i,
    /bot/i,
    /crawler/i,
    /spider/i,
    /scraper/i,
    /sqlmap/i,
    /nmap/i,
    /masscan/i,
    /nuclei/i,
    /gobuster/i,
    /dirb/i,
    /dirbuster/i,
    /nikto/i,
    /w3af/i,
    /burpsuite/i,
    /owasp/i,
    /acunetix/i,
    /nessus/i,
    /openvas/i,
    /^$/  // Empty user agent
  ]
  
  const hasSuspiciousAgent = suspiciousAgents.some(pattern => pattern.test(userAgent))
  
  // Only block suspicious agents if not a legitimate monitoring tool and not accessing whitelisted endpoints
  if (hasSuspiciousAgent && !isLegitimateAgent && !isWhitelistedEndpoint) {
    ipData.suspiciousCount++
    console.log(`Suspicious User-Agent from ${clientIP}: "${userAgent}" accessing ${req.path}`)
    return res.status(403).json({ error: 'Forbidden' })
  }
  
  // Block suspicious requests early
  const suspiciousPatterns = [
    /\/config\//i,
    /\.(env|ini|conf|cfg|bak|old|sql|log|zip|tar\.gz|yaml|yml|json|xml|txt)$/i,
    /wp-config/i,
    /wp-content/i,
    /wp-admin/i,
    /wp-login/i,
    /\.git/i,
    /\.svn/i,
    /\.hg/i,
    /\/admin/i,
    /\/administrator/i,
    /phpmyadmin/i,
    /xmlrpc/i,
    /cgi-bin/i,
    /luci/i,  // Router admin interface
    /awstats/i, // Web stats
    /_profiler/i, // Debug profilers
    /phpinfo/i,
    /aws-secret/i,
    /secret/i,
    /password/i,
    /backup/i,
    /\.ssh/i,
    /\.docker/i,
    /docker-compose/i,
    /package\.json/i,
    /package-lock\.json/i,
    /composer\./i,
    /\/\./,  // directory traversal attempts
    /\.\./,   // parent directory access attempts
    /PROPFIND/i, // WebDAV attacks
    /php$/i,  // Direct PHP file access
    /jsp$/i,  // JSP file access
    /aspx?$/i, // ASP file access
    /__pycache__/i,
    /node_modules/i,
    /\.vscode/i,
    /\.idea/i,
    /\/bins?\/$/i,  // Common probe paths
    /\/tmp\/$/i,
    /\/var\/$/i,
    /\/etc\/$/i,
    /\/usr\/$/i,
    /\/opt\/$/i,
    /\/home\/$/i,
    /\/root\/$/i,
    /\/proc\/$/i,
    /\/sys\/$/i,
    /\/dev\/$/i,
    /\/mnt\/$/i,
    /server-status/i,
    /server-info/i,
    /info\.php/i,
    /test\.php/i,
    /shell/i,
    /cmd/i,
    /console/i,
    /terminal/i,
    /debug/i,
    /trace/i,
    /\/[a-z]+[0-9]+/,  // Patterns like /aaa9, /test123
    /\/bins?\/$/i,     // /bin/ or /bins/ with trailing slash
    /\/[a-z]{3,6}\/$/i // Short random paths with trailing slash like /aaa/
  ]
  
  const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(req.path))
  
  // Skip suspicious pattern check for whitelisted endpoints
  if (isSuspicious && !isWhitelistedEndpoint) {
    ipData.suspiciousCount++
    console.log(`Suspicious request #${ipData.suspiciousCount} from ${clientIP}: ${req.method} ${req.path}`)
    
    // Aggressive progressive punishment system
    let banDuration = 0
    if (ipData.suspiciousCount >= 10) {
      banDuration = 24 * 60 * 60 * 1000  // 24 hours for persistent attackers
    } else if (ipData.suspiciousCount >= 5) {
      banDuration = 60 * 60 * 1000  // 1 hour
    } else if (ipData.suspiciousCount >= 3) {
      banDuration = 30 * 60 * 1000  // 30 minutes  
    } else if (ipData.suspiciousCount >= 2) {
      banDuration = 10 * 60 * 1000   // 10 minutes
    } else if (ipData.suspiciousCount >= 1) {
      banDuration = 2 * 60 * 1000   // 2 minutes for first offense
    }
    
    if (banDuration > 0) {
      ipData.banUntil = now + banDuration
      console.log(`IP ${clientIP} banned for ${banDuration/60000} minutes (${ipData.suspiciousCount} suspicious requests)`)
      return res.status(429).json({ 
        error: 'Too many suspicious requests', 
        message: `IP banned due to suspicious activity.`,
        retryAfter: banDuration / 1000
      })
    }
    
    return res.status(404).json({ error: 'Not found' })
  }
  
  // Rate limiting for legitimate requests (prevent spam)
  // More lenient rate limiting for AWS internal IPs and health checks
  const oneMinuteAgo = now - 60 * 1000
  const recentRequests = ipData.requests.filter(time => time > oneMinuteAgo)
  const rateLimit = (isAWSInternalIP && isWhitelistedEndpoint) ? 600 : 120 // Higher limit for health checks
  
  if (recentRequests.length > rateLimit) {
    console.log(`Rate limit exceeded for ${clientIP}: ${recentRequests.length} requests/min (limit: ${rateLimit})`)
    // Don't ban AWS internal IPs for health check rate limits
    if (!isAWSInternalIP) {
      ipData.banUntil = now + 5 * 60 * 1000 // 5 minute timeout for external IPs only
    }
    return res.status(429).json({ 
      error: 'Rate limit exceeded', 
      message: 'Too many requests',
      retryAfter: 300
    })
  }
  
  next()
})

app.use(morgan('dev'))
app.use(cors())
app.use(express.json({ limit:'10mb' }))

// Ensure data dirs
for (const p of ['data', 'data/uploads', 'data/outputs', 'data/thumbnails']) {
  const full = path.join(__dirname, '..', p)
  if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive:true })
}

// Media serving (authenticated paths also available via API meta)
app.use('/media/uploads', express.static(path.join(__dirname, '..', 'data', 'uploads')))
app.use('/media/outputs', express.static(path.join(__dirname, '..', 'data', 'outputs')))
app.use('/media/thumbnails', express.static(path.join(__dirname, '..', 'data', 'thumbnails')))

// API
app.use('/api/v1', router)

app.get('/api/v1/health', (_,res)=> res.json({ ok:true }))

// Admin endpoint to check banned IPs (requires authentication in production)
app.get('/api/v1/security/status', (req, res) => {
  const now = Date.now()
  const stats = {
    totalIPs: ipTracker.size,
    bannedIPs: 0,
    suspiciousIPs: 0,
    topOffenders: []
  }
  
  const ipDetails = []
  for (const [ip, data] of ipTracker.entries()) {
    const isBanned = data.banUntil && now < data.banUntil
    const isSuspicious = data.suspiciousCount > 0
    
    if (isBanned) stats.bannedIPs++
    if (isSuspicious) stats.suspiciousIPs++
    
    ipDetails.push({
      ip,
      suspiciousCount: data.suspiciousCount,
      isBanned,
      banUntil: data.banUntil,
      recentRequests: data.requests.filter(time => time > now - 60000).length
    })
  }
  
  // Sort by suspicious count for top offenders
  stats.topOffenders = ipDetails
    .filter(ip => ip.suspiciousCount > 0)
    .sort((a, b) => b.suspiciousCount - a.suspiciousCount)
    .slice(0, 10)
  
  res.json(stats)
})

// Static client
app.use(express.static(path.join(__dirname, '..', 'public')))

// Strict SPA fallback - only for legitimate application routes
app.get('*', (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0]
  
  // Only allow very specific SPA routes - whitelist approach
  const allowedSPARoutes = [
    '/',
    '/login', 
    '/editor',
    '/projects',
    '/files',
    '/settings'
  ]
  
  // Check if it's an allowed SPA route (strict whitelist)
  const isAllowedSPARoute = allowedSPARoutes.includes(req.path)
  
  // Enhanced suspicious pattern detection
  const hasSuspiciousPattern = req.path.includes('.') || 
                              req.path.includes('config') || 
                              req.path.includes('admin') ||
                              req.path.includes('bin') ||
                              req.path.includes('tmp') ||
                              req.path.includes('var') ||
                              req.path.includes('etc') ||
                              req.path.includes('usr') ||
                              req.path.includes('opt') ||
                              req.path.includes('home') ||
                              req.path.includes('root') ||
                              req.path.includes('proc') ||
                              req.path.includes('sys') ||
                              req.path.includes('dev') ||
                              req.path.includes('mnt') ||
                              req.path.length > 20 || // Reduce max path length
                              /[^a-zA-Z0-9\-_\/]/.test(req.path) || // Only allow safe characters
                              /\/[a-z]+[0-9]+/.test(req.path) || // Block patterns like /aaa9
                              /^\/(bin|tmp|var|etc|usr|opt|home|root|proc|sys|dev|mnt)/i || // Block system paths
                              req.path.endsWith('/') && req.path !== '/' // Block trailing slashes except root
  
  // Block if suspicious pattern OR not in allowed routes
  if (hasSuspiciousPattern || !isAllowedSPARoute) {
    // Track this as suspicious activity
    if (!ipTracker.has(clientIP)) {
      ipTracker.set(clientIP, { requests: [], suspiciousCount: 0, banUntil: null })
    }
    
    const ipData = ipTracker.get(clientIP)
    ipData.suspiciousCount++
    
    // Log the specific reason for blocking
    const reason = hasSuspiciousPattern ? 'suspicious pattern' : 'not in whitelist'
    console.log(`Blocked SPA access attempt #${ipData.suspiciousCount} from ${clientIP}: ${req.method} ${req.path} (${reason})`)
    
    // Apply progressive banning for SPA route abuse
    let banDuration = 0
    if (ipData.suspiciousCount >= 5) {
      banDuration = 30 * 60 * 1000  // 30 minutes
    } else if (ipData.suspiciousCount >= 3) {
      banDuration = 10 * 60 * 1000  // 10 minutes
    } else if (ipData.suspiciousCount >= 2) {
      banDuration = 5 * 60 * 1000   // 5 minutes
    }
    
    if (banDuration > 0) {
      ipData.banUntil = Date.now() + banDuration
      console.log(`IP ${clientIP} banned for ${banDuration/60000} minutes due to SPA route abuse`)
      return res.status(429).json({ 
        error: 'Too many invalid requests', 
        message: `Access denied due to suspicious activity`,
        retryAfter: banDuration / 1000
      })
    }
    
    return res.status(404).json({ error: 'Not found' })
  }
  
  // Log legitimate SPA route requests (only for debugging)
  if (req.path !== '/') {
    console.log(`SPA route: ${req.path} from ${clientIP}`)
  }
  
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'))
})

const port = process.env.PORT || 3000
app.listen(port, ()=> console.log(`Server listening on :${port}`))
