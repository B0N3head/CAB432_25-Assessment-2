import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json')

export function getDB(){
  if (!fs.existsSync(DB_PATH)){
    const init = { files:[], projects:[], jobs:[] }
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2))
    return init
  }
  const raw = fs.readFileSync(DB_PATH, 'utf8')
  try { return JSON.parse(raw) } catch { return { files:[], projects:[], jobs:[] } }
}

export function saveDB(db){
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2))
}
