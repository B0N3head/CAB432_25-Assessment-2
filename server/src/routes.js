import express from 'express'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'
import { getDB, saveDB } from './storage.js'
import { users, signToken, authMiddleware, requireRole } from './security.js'
import { probeMedia, generateThumbnail, buildFfmpegCommand, execFfmpeg } from './video.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
export const router = express.Router()

// ---- On-the-fly low-res preview proxy for uploaded media ----
// Scales maintaining aspect ratio, targeting 640x360 by default.
router.get('/preview', authMiddleware, async (req,res)=> {
  try {
    const { fileId, h = 360 } = req.query
    if (!fileId) return res.status(400).json({ error: 'fileId required' })
    const db = getDB()
    const f = db.files.find(x=> x.id === fileId)
    if (!f) return res.status(404).json({ error: 'not found' })
    if (req.user.role!=='admin' && f.ownerId!==req.user.id) return res.status(403).json({ error:'forbidden' })

    res.setHeader('Content-Type','video/mp4')
    const height = Math.max(120, parseInt(h))
    const child = await import('child_process').then(m=> m.spawn('ffmpeg', [
      '-hide_banner','-loglevel','error','-i', f.path,
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
router.get('/files', authMiddleware, (req,res)=> {
  const db = getDB()
  const { page=1, limit=50, owner='me' } = req.query
  const items = db.files.filter(f=> req.user.role==='admin' || f.ownerId===req.user.id)
  const p = parseInt(page), l = parseInt(limit)
  const slice = items.slice((p-1)*l, p*l)
  res.json({ items: slice, total: items.length, page:p, limit:l })
})

router.post('/files', authMiddleware, upload.array('files', 20), async (req,res)=> {
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

// ---- Projects ----
router.get('/projects', authMiddleware, (req,res)=> {
  const db = getDB()
  const items = db.projects.filter(p=> req.user.role==='admin' || p.ownerId===req.user.id)
  const { page=1, limit=50 } = req.query
  const p = parseInt(page), l = parseInt(limit)
  const slice = items.slice((p-1)*l, p*l)
  res.json({ items: slice, total: items.length, page:p, limit:l })
})

router.post('/projects', authMiddleware, (req,res)=> {
  const { name, width=1920, height=1080, fps=30 } = req.body || {}
  if (!name) return res.status(400).json({ error:'name required' })
  const db = getDB()
  const proj = { id: uuidv4(), ownerId: req.user.id, name, width, height, fps, tracks:[
    { id: uuidv4(), type: 'video', name:'V1', clips:[] },
    { id: uuidv4(), type: 'audio', name:'A1', clips:[] },
  ], createdAt: Date.now(), updatedAt: Date.now() }
  db.projects.push(proj); saveDB(db)
  res.status(201).json(proj)
})

router.get('/projects/:id', authMiddleware, (req,res)=> {
  const db = getDB()
  const proj = db.projects.find(p=> p.id===req.params.id)
  if (!proj) return res.status(404).json({ error:'not found' })
  if (req.user.role!=='admin' && proj.ownerId!==req.user.id) return res.status(403).json({ error:'forbidden' })
  res.json(proj)
})

router.put('/projects/:id', authMiddleware, (req,res)=> {
  const db = getDB()
  const idx = db.projects.findIndex(p=> p.id===req.params.id)
  if (idx<0) return res.status(404).json({ error:'not found' })
  if (req.user.role!=='admin' && db.projects[idx].ownerId!==req.user.id) return res.status(403).json({ error:'forbidden' })
  const updated = { ...db.projects[idx], ...req.body, id: db.projects[idx].id, ownerId: db.projects[idx].ownerId, updatedAt: Date.now() }
  db.projects[idx] = updated; saveDB(db)
  res.json(updated)
})

// ---- Render ----
router.post('/projects/:id/render', authMiddleware, async (req,res)=> {
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
    const { code, stderr } = await execFfmpeg(cmd, outPath)
    const job = { id: outId, projectId: proj.id, ownerId: proj.ownerId, output: `/media/outputs/${outName}`, createdAt: Date.now(), code, stderr }
    db.jobs.push(job); saveDB(db)
    res.status(201).json({ output: job.output, job })
  } catch (e) {
    console.error('render error', e)
    res.status(500).json({ error:'render failed', detail: e.message })
  }
})

export default router
