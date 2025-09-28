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
    console.log(`Temporary Banned IP ${clientIP} attempted access (${remainingTime}min remaining)`)
    return res.status(429).json({ 
      error: 'Too many requests', 
      message: `Try again later :)`,
      retryAfter: Math.ceil((ipData.banUntil - now) / 1000)
    })
  }
  
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  
  // Track request
  ipData.requests.push(now)
  
  // Block suspicious requests early
  const suspiciousPatterns = [
    /\/config\//i,
    /\.(env|ini|conf|cfg|bak|old|sql|log|zip|tar\.gz)$/i,
    /wp-config/i,
    /\.git/i,
    /\.svn/i,
    /admin/i,
    /phpmyadmin/i,
    /xmlrpc/i,
    /cgi-bin/i,
    /\/\./,  // directory traversal attempts
    /\.\./   // parent directory access attempts
  ]
  
  const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(req.path))
  
  if (isSuspicious) {
    ipData.suspiciousCount++
    console.log(`Suspicious request #${ipData.suspiciousCount} from ${clientIP}: ${req.method} ${req.path}`)
    
    // Progressive punishment system
    let banDuration = 0
    if (ipData.suspiciousCount >= 5) {
      banDuration = 30 * 60 * 1000  // 30 minutes
    } else if (ipData.suspiciousCount >= 3) {
      banDuration = 10 * 60 * 1000  // 10 minutes  
    } else if (ipData.suspiciousCount >= 2) {
      banDuration = 5 * 60 * 1000   // 5 minutes
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
  const oneMinuteAgo = now - 60 * 1000
  const recentRequests = ipData.requests.filter(time => time > oneMinuteAgo)
  
  if (recentRequests.length > 120) { // Max 120 requests per minute
    console.log(`Rate limit exceeded for ${clientIP}: ${recentRequests.length} requests/min`)
    ipData.banUntil = now + 5 * 60 * 1000 // 5 minute timeout
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

// Strict SPA fallback - only for legitimate routes
app.get('*', (req, res) => {
  // Only serve SPA for legitimate client routes (no file extensions)
  if (req.path.includes('.') || req.path.includes('config') || req.path.includes('admin')) {
    return res.status(404).json({ error: 'Not found' })
  }
  
  // Log legitimate SPA route requests
  console.log(`SPA route: ${req.path} from ${req.ip}`)
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'))
})

const port = process.env.PORT || 3000
app.listen(port, ()=> console.log(`Server listening on :${port}`))
