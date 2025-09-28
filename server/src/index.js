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

// Security middleware
app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  
  // Block suspicious requests early
  const suspiciousPatterns = [
    /\/config\//i,
    /\.(env|ini|conf|cfg|bak|old|sql|log|zip|tar\.gz)$/i,
    /wp-config/i,
    /\.git/i,
    /\.svn/i,
    /admin/i,
    /phpmyadmin/i,
    /xmlrpc/i
  ]
  
  const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(req.path))
  
  if (isSuspicious) {
    console.log(`Blocked suspicious request: ${req.method} ${req.path} from ${req.ip}`)
    return res.status(404).json({ error: 'Not found' })
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
