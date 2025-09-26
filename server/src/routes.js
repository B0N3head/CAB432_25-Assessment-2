import express from 'express'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'
import { getDB, saveDB, getUserFiles, saveUserFile, getUserFile, deleteUserFile, getUserProjects, saveUserProject } from './storage.js'
import { users, signToken, authMiddleware, requireRole } from './security.js'
import { probeMedia, generateThumbnail, buildFfmpegCommand, execFfmpeg, execFfmpegWithProgress } from './video.js'
import config from './config.js'
import { authMiddlewareCognito } from './cognito.js'
import { presignUpload, presignDownload } from './s3.js'
import { cacheGet, cacheSet } from './cache.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
export const router = express.Router()

//auth middleware use Cognito if configured, else legacy JWT
const auth = config.features.useCognito ? authMiddlewareCognito() : authMiddleware

// realtime low-res preview proxy for uploaded media
// scales maintaining aspect ratio, targeting 640x360 by default.
// public config for client feature toggles
// Helper function to get version info
function getVersionInfo() {
  let serverVersion = '1.0.0'
  let clientVersion = '1.0.0'
  let buildTime = new Date().toISOString()
  let gitHash = ''
  let deployDate = ''
  
  try {
    // Try build-info.json first (created by update-version script)
    const buildInfo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build-info.json'), 'utf8'))
    
    // Support both old and new format
    if (buildInfo.serverVersion && buildInfo.clientVersion) {
      // New format with separate versions
      serverVersion = buildInfo.serverVersion
      clientVersion = buildInfo.clientVersion
    } else if (buildInfo.version) {
      // Legacy format - use same version for both
      serverVersion = buildInfo.version
      clientVersion = buildInfo.version
    }
    
    buildTime = buildInfo.buildTime || buildTime
    gitHash = buildInfo.gitHash || ''
    deployDate = buildInfo.deployDate || ''
  } catch {
    // Fallback to package.json
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
      serverVersion = pkg.version || serverVersion
    } catch {}
  }
  
  return { serverVersion, clientVersion, buildTime, gitHash, deployDate }
}

// Health check endpoint (used by Docker healthcheck)
router.get('/health', (_, res)=> {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

// Dedicated version endpoint
router.get('/version', (_, res)=> {
  const versionInfo = getVersionInfo()
  res.json({
    server: {
      version: versionInfo.serverVersion,
      buildTime: versionInfo.buildTime,
      gitHash: versionInfo.gitHash,
      deployDate: versionInfo.deployDate
    },
    client: {
      version: versionInfo.clientVersion
    },
    api: 'v1',
    timestamp: new Date().toISOString()
  })
})

router.get('/config', (_, res)=> {
  const versionInfo = getVersionInfo()

  res.json({
    serverVersion: versionInfo.serverVersion,
    clientVersion: versionInfo.clientVersion,
    buildTime: versionInfo.buildTime,
    gitHash: versionInfo.gitHash,
    deployDate: versionInfo.deployDate,
    region: config.region,
    features: config.features,
    cognito: { 
      domain: config.cognito.domain, 
      clientId: config.cognito.clientId, 
      userPoolId: !!config.cognito.userPoolId ? 'configured' : '',
      redirectUri: config.cognito.redirectUri || '',
      hasClientSecret: !!config.cognito.clientSecret
    },
    s3: { 
      bucket: config.s3.bucket, 
      prefixes: { 
        uploads: config.s3.uploadsPrefix, 
        outputs: config.s3.outputsPrefix, 
        thumbs: config.s3.thumbsPrefix 
      } 
    },
    secretsManager: {
      enabled: config.features.useSecretsManager,
      loadedSecrets: {
        jwt: !!config.jwtSecret && config.jwtSecret !== 'devsecret',
        cognito: !!config.cognito.clientSecret,
        database: !!(config.database && config.database.accessKeyId),
        externalApis: !!(config.externalApis && Object.keys(config.externalApis).length > 0)
      }
    }
  })
})

router.get('/preview', auth, async (req,res)=> {
  try {
    const { fileId, h = 360 } = req.query
    if (!fileId) return res.status(400).json({ error: 'fileId required' })
    const db = getDB()
    const f = db.files.find(x=> x.id === fileId)
    if (!f) return res.status(404).json({ error: 'not found' })
    if (req.user.role!=='admin' && f.ownerId!==req.user.id) return res.status(403).json({ error:'forbidden' })

    res.setHeader('Content-Type','video/mp4')
    const height = Math.max(120, parseInt(h))
    // Determine ffmpeg input (local file path or presigned S3 URL)
    let input = f.path
    if (!input && f.s3Key && config.features.useS3) {
      const { url } = await presignDownload({ key: f.s3Key })
      input = url
    }
    if (!input) return res.status(404).json({ error:'input not available' })
    const child = await import('child_process').then(m=> m.spawn('ffmpeg', [
      '-hide_banner','-loglevel','error','-i', input,
      // keep aspect ratio, constrain height; width auto (-2) preserves mod2
      '-vf', `scale=-2:${height}`,
      '-an',
      '-c:v','libx264','-preset','veryfast','-crf','28',
      // MP4 over stdout requires fragmented MP4, not faststart (which seeks)
      '-movflags','empty_moov+frag_keyframe+default_base_moof',
      // shorter GOP improves fragmenting but increases bitrate a bit
      '-g','60','-keyint_min','60',
      '-f','mp4','-'
    ], { stdio:['ignore','pipe','inherit'] }))
    child.stdout.pipe(res)
    child.on('close', ()=> res.end())
  } catch (e) {
    console.error('preview error', e)
    res.status(500).json({ error:'preview failed' })
  }
})

// ---- Auth ----
// Legacy login only used in local dev without Cognito
router.post('/auth/login', (req,res)=> {
  const { username, password } = req.body || {}
  const u = users.find(u=> u.username===username && u.password===password)
  if (!u) return res.status(401).json({ error:'Invalid credentials' })
  const token = signToken({ id: u.id, username: u.username, role: u.role })
  res.json({ token })
})

// ---- Multer upload to /data/uploads ----
const storage = multer.diskStorage({
  destination: (req, file, cb)=> {
    const dest = path.join(__dirname, '..', 'data', 'uploads', req.user?.id || 'public')
    fs.mkdirSync(dest, { recursive:true })
    cb(null, dest)
  },
  filename: (req, file, cb)=> {
    const id = uuidv4()
    const ext = path.extname(file.originalname)
    cb(null, `${id}${ext}`)
  }
})
const upload = multer({ storage })

// ---- Files ----
router.get('/files', auth, async (req,res)=> {
  try {
    const { page=1, limit=50 } = req.query
    const p = parseInt(page), l = parseInt(limit)
    const key = `files:${req.user.id}:${p}:${l}`
    const cached = await cacheGet(key)
    if (cached) return res.json(cached)
    
    // Get user's files using DynamoDB-aware storage
    const allItems = await getUserFiles(req.user.username || req.user.id)
    
    // Filter files for admin role or ownership
    const items = allItems.filter(f=> req.user.role==='admin' || f.ownerId===req.user.id)
    const slice = items.slice((p-1)*l, p*l)
    const payload = { items: slice, total: items.length, page:p, limit:l }
    res.json(payload)
    cacheSet(key, payload, 120).catch(()=>{})
  } catch (error) {
    console.error('Error getting files:', error)
    res.status(500).json({ error: 'Failed to get files' })
  }
})

// If S3 is configured, prefer presigned uploads from client
router.post('/files', auth, upload.array('files', 20), async (req,res)=> {
  const db = getDB()
  const saved = []
  for (const file of req.files) {
    const id = path.basename(file.filename, path.extname(file.filename))
    const mimetype = file.mimetype
    const fileRec = {
      id, ownerId: req.user.id, path: file.path, name: file.originalname, mimetype,
      url: `/media/uploads/${req.user.id}/${file.filename}`, createdAt: Date.now()
    }
    // Optional: generate thumbnail for videos
    try {
      if (mimetype.startsWith('video')) {
        const thumb = path.join(__dirname, '..', 'data', 'thumbnails', `${id}.jpg`)
        await generateThumbnail(file.path, thumb)
        fileRec.thumbnail = `/media/thumbnails/${id}.jpg`
        const meta = await probeMedia(file.path)
        if (meta?.format?.duration) fileRec.duration = parseFloat(meta.format.duration)
      }
    } catch (e) { console.error('thumb/probe error', e) }

    db.files.push(fileRec)
    saved.push(fileRec)
  }
  saveDB(db)
  res.status(201).json({ items: saved })
})

// S3 presign endpoints (used when client uploads directly to S3)
router.post('/files/presign-upload', auth, async (req,res)=> {
  if (!config.features.useS3) return res.status(400).json({ error: 'S3 not configured' })
  const { filename, contentType } = req.body || {}
  if (!filename || !contentType) return res.status(400).json({ error: 'filename and contentType required' })
  const id = uuidv4()
  const ext = path.extname(filename)
  const key = `${config.s3.uploadsPrefix}${req.user.id}/${id}${ext}`
  console.log('Presign request:', { filename, contentType, key, userId: req.user.id })
  try {
    const signed = await presignUpload({ key, contentType })
    res.json({ id, key, ...signed })
  } catch (e) { 
    console.error('Presign route error:', e)
    res.status(500).json({ error: 'presign failed', detail: e.message }) 
  }
})

// After successful client upload to S3, register metadata
router.post('/files/register', auth, async (req,res)=> {
  try {
    const { id, originalName, key, mimetype, duration } = req.body || {}
    if (!id || !key || !mimetype) return res.status(400).json({ error: 'id, key, mimetype required' })
    
    const rec = { 
      id, 
      ownerId: req.user.id, 
      s3Key: key, 
      name: originalName || id, 
      mimetype, 
      createdAt: Date.now() 
    }
    if (duration) rec.duration = duration
    
    // Save file using DynamoDB-aware storage
    await saveUserFile(req.user.username || req.user.id, rec)
    
    console.log('File registered successfully:', rec.id)
    res.status(201).json(rec)
  } catch (error) {
    console.error('Error registering file:', error)
    res.status(500).json({ error: 'Failed to register file' })
  }
})

// Generate a presigned download URL for a file
router.get('/files/:id/presign-download', auth, async (req,res)=> {
  try {
    const f = await getUserFile(req.user.username || req.user.id, req.params.id)
    if (!f) return res.status(404).json({ error: 'not found' })
    if (req.user.role!=='admin' && f.ownerId!==req.user.id) return res.status(403).json({ error:'forbidden' })
    if (!f.s3Key || !config.features.useS3) return res.status(400).json({ error: 'not stored in S3' })
    
    const { url } = await presignDownload({ key: f.s3Key })
    res.json({ url })
  } catch (e) { 
    console.error('Error in presign-download:', e)
    res.status(500).json({ error: 'presign failed' }) 
  }
})

// ---- Projects ----
router.get('/projects', auth, async (req,res)=> {
  try {
    const { page=1, limit=50 } = req.query
    const p = parseInt(page), l = parseInt(limit)
    const key = `projects:${req.user.id}:${p}:${l}`
    const cached = await cacheGet(key)
    if (cached) return res.json(cached)
    
    // Get user's projects using DynamoDB-aware storage
    const userProjects = await getUserProjects(req.user.username || req.user.id)
    
    // Convert object to array if needed
    const projectsArray = Array.isArray(userProjects) ? userProjects : Object.values(userProjects || {})
    
    // Filter projects for admin role or ownership
    const items = projectsArray.filter(p=> req.user.role==='admin' || p.ownerId===req.user.id)
    const slice = items.slice((p-1)*l, p*l)
    const payload = { items: slice, total: items.length, page:p, limit:l }
    res.json(payload)
    cacheSet(key, payload, 120).catch(()=>{})
  } catch (error) {
    console.error('Error getting projects:', error)
    res.status(500).json({ error: 'Failed to get projects' })
  }
})

router.post('/projects', auth, async (req,res)=> {
  try {
    const { name, width=1920, height=1080, fps=30 } = req.body || {}
    if (!name) return res.status(400).json({ error:'name required' })
    
    const proj = { 
      id: uuidv4(), 
      ownerId: req.user.id, 
      name, 
      width, 
      height, 
      fps, 
      tracks:[
        { id: uuidv4(), type: 'video', name:'V1', clips:[] },
        { id: uuidv4(), type: 'audio', name:'A1', clips:[] },
      ], 
      createdAt: Date.now(), 
      updatedAt: Date.now() 
    }
    
    // Save project using DynamoDB-aware storage
    await saveUserProject(req.user.username || req.user.id, proj.id, proj)
    
    console.log('Project created successfully:', proj.id)
    res.status(201).json(proj)
  } catch (error) {
    console.error('Error creating project:', error)
    res.status(500).json({ error: 'Failed to create project' })
  }
})

router.get('/projects/:id', auth, (req,res)=> {
  const db = getDB()
  const proj = db.projects.find(p=> p.id===req.params.id)
  if (!proj) return res.status(404).json({ error:'not found' })
  if (req.user.role!=='admin' && proj.ownerId!==req.user.id) return res.status(403).json({ error:'forbidden' })
  res.json(proj)
})

router.put('/projects/:id', auth, (req,res)=> {
  const db = getDB()
  const idx = db.projects.findIndex(p=> p.id===req.params.id)
  if (idx<0) return res.status(404).json({ error:'not found' })
  if (req.user.role!=='admin' && db.projects[idx].ownerId!==req.user.id) return res.status(403).json({ error:'forbidden' })
  const updated = { ...db.projects[idx], ...req.body, id: db.projects[idx].id, ownerId: db.projects[idx].ownerId, updatedAt: Date.now() }
  db.projects[idx] = updated; saveDB(db)
  res.json(updated)
})

// ---- Render ----
router.post('/projects/:id/render', auth, async (req,res)=> {
  const db = getDB()
  const proj = db.projects.find(p=> p.id===req.params.id)
  if (!proj) return res.status(404).json({ error:'not found' })
  if (req.user.role!=='admin' && proj.ownerId!==req.user.id) return res.status(403).json({ error:'forbidden' })

  const { preset='crispstream', renditions=['1080p'] } = req.body || {}

  // Build ffmpeg command
  const cmd = await buildFfmpegCommand(proj, db.files, { preset, renditions })

  // Output path
  const outId = uuidv4()
  const outName = `${outId}.mp4`
  const outPath = path.join(__dirname, '..', 'data', 'outputs', outName)

  try {
    console.log('ffmpeg args:', cmd.join(' '))
    console.log('render output path:', outPath)
    const { code, stderr } = await execFfmpegWithProgress(cmd, outPath, outId)
    const job = { id: outId, projectId: proj.id, ownerId: proj.ownerId, output: `/media/outputs/${outName}`, createdAt: Date.now(), code, stderr }
    db.jobs.push(job); saveDB(db)
    res.status(201).json({ output: job.output, job })
  } catch (e) {
    console.error('render error', e)
    res.status(500).json({ error:'render failed', detail: e.message })
  }
})

// SSE progress endpoint
router.get('/jobs/:id/events', auth, async (req,res)=> {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  const id = req.params.id
  let alive = true
  req.on('close', ()=> { alive = false })
  const send = (event, data) => {
    if (!alive) return
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }
  // Initial push from cache if present
  const state = await cacheGet(`job:${id}`)
  if (state) send('progress', state)
  // Heartbeat to keep connection alive
  const iv = setInterval(async ()=> {
    if (!alive) { clearInterval(iv); return }
    const s = await cacheGet(`job:${id}`)
    if (s) send('progress', s)
    else send('ping', { t: Date.now() })
  }, 2000)
})

export default router
