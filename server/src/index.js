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
app.use(morgan('dev'))
app.use(cors())
app.use(express.json({ limit:'10mb' }))

// Ensure data dirs
for (const p of ['data', 'data/uploads', 'data/outputs', 'data/thumbnails']) {
  const full = path.join(__dirname, '..', p)
  if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive:true })
}

// Static client
app.use(express.static(path.join(__dirname, '..', 'public')))

// Media serving (authenticated paths also available via API meta)
app.use('/media/uploads', express.static(path.join(__dirname, '..', 'data', 'uploads')))
app.use('/media/outputs', express.static(path.join(__dirname, '..', 'data', 'outputs')))
app.use('/media/thumbnails', express.static(path.join(__dirname, '..', 'data', 'thumbnails')))

// API
app.use('/api/v1', router)

app.get('/api/v1/health', (_,res)=> res.json({ ok:true }))

// Fallback to SPA
app.get('*', (req,res)=> {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'))
})

const port = process.env.PORT || 3000
app.listen(port, ()=> console.log(`Server listening on :${port}`))
