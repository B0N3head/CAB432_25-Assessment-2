import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { VideoEditorDB } from './dynamodb.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json')
const USE_DYNAMODB = process.env.DYNAMODB_TABLE_NAME && process.env.DYNAMODB_TABLE_NAME !== ''

// Initialize DynamoDB client if configured
let dynamoDB = null
if (USE_DYNAMODB) {
  dynamoDB = new VideoEditorDB()
  console.log('Storage configured for DynamoDB')
} else {
  console.log('Storage using local JSON file (development mode)')
}

// Legacy JSON file functions (kept for backward compatibility and local development)
function getJSONDB(){
  if (!fs.existsSync(DB_PATH)){
    const init = { files:[], projects:[], jobs:[] }
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2))
    return init
  }
  const raw = fs.readFileSync(DB_PATH, 'utf8')
  try { return JSON.parse(raw) } catch { return { files:[], projects:[], jobs:[] } }
}

function saveJSONDB(db){
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2))
}

// Unified storage interface
export async function getDB(){
  if (USE_DYNAMODB) {
    // For DynamoDB, we need a user context - this is a simplified version
    // In practice, you'd pass the username from the authenticated user
    console.warn('getDB() called without user context - DynamoDB requires user-specific data')
    return { files:[], projects:[], jobs:[] }
  } else {
    return getJSONDB()
  }
}

export async function saveDB(db){
  if (USE_DYNAMODB) {
    console.warn('saveDB() called without user context - use user-specific methods instead')
    return false
  } else {
    saveJSONDB(db)
    return true
  }
}

// New user-aware storage functions for DynamoDB
export async function getUserProjects(username) {
  if (USE_DYNAMODB) {
    return await dynamoDB.getUserProjects(username)
  } else {
    const db = getJSONDB()
    return db.projects || []
  }
}

export async function saveUserProject(username, projectId, projectData) {
  if (USE_DYNAMODB) {
    return await dynamoDB.saveProject(username, projectId, projectData)
  } else {
    const db = getJSONDB()
    if (!db.projects) db.projects = []
    
    // Find and update or create new project
    const existingIndex = db.projects.findIndex(p => p.id === projectId)
    const project = { ...projectData, id: projectId, updatedAt: new Date().toISOString() }
    
    if (existingIndex >= 0) {
      db.projects[existingIndex] = project
    } else {
      db.projects.push(project)
    }
    
    saveJSONDB(db)
    return true
  }
}

export async function deleteUserProject(username, projectId) {
  if (USE_DYNAMODB) {
    return await dynamoDB.deleteProject(username, projectId)
  } else {
    const db = getJSONDB()
    if (!db.projects) db.projects = []
    
    db.projects = db.projects.filter(p => p.id !== projectId)
    saveJSONDB(db)
    return true
  }
}

export async function getUserMediaMetadata(username) {
  if (USE_DYNAMODB) {
    return await dynamoDB.getUserMedia(username)
  } else {
    const db = getJSONDB()
    return db.files || []
  }
}

export async function saveMediaMetadata(username, mediaId, metadata) {
  if (USE_DYNAMODB) {
    return await dynamoDB.saveFile(username, metadata)
  } else {
    const db = getJSONDB()
    if (!db.files) db.files = []
    
    // Find and update or create new media entry
    const existingIndex = db.files.findIndex(f => f.id === mediaId)
    const mediaEntry = { ...metadata, id: mediaId, uploadedAt: new Date().toISOString() }
    
    if (existingIndex >= 0) {
      db.files[existingIndex] = mediaEntry
    } else {
      db.files.push(mediaEntry)
    }
    
    saveJSONDB(db)
    return true
  }
}

// File management functions
export async function getUserFiles(username) {
  if (USE_DYNAMODB) {
    return await dynamoDB.getUserFiles(username)
  } else {
    const db = getJSONDB()
    return db.files || []
  }
}

export async function saveUserFile(username, fileData) {
  if (USE_DYNAMODB) {
    return await dynamoDB.saveFile(username, fileData)
  } else {
    const db = getJSONDB()
    if (!db.files) db.files = []
    
    // Find and update or create new file entry
    const existingIndex = db.files.findIndex(f => f.id === fileData.id)
    
    if (existingIndex >= 0) {
      db.files[existingIndex] = fileData
    } else {
      db.files.push(fileData)
    }
    
    saveJSONDB(db)
    return true
  }
}

export async function getUserFile(username, fileId) {
  if (USE_DYNAMODB) {
    return await dynamoDB.getFile(username, fileId)
  } else {
    const db = getJSONDB()
    if (!db.files) return null
    return db.files.find(f => f.id === fileId) || null
  }
}

export async function getUserProject(username, projectId) {
  if (USE_DYNAMODB) {
    return await dynamoDB.getProject(username, projectId)
  } else {
    const db = getJSONDB()
    if (!db.projects) return null
    return db.projects.find(p => p.id === projectId) || null
  }
}

// Admin functions to access all users' data
export async function getAllFiles() {
  if (USE_DYNAMODB) {
    return await dynamoDB.getAllFiles()
  } else {
    const db = getJSONDB()
    return db.files || []
  }
}

export async function getAllProjects() {
  if (USE_DYNAMODB) {
    return await dynamoDB.getAllProjects()
  } else {
    const db = getJSONDB()
    return db.projects || []
  }
}

export async function getFileForAdmin(fileId) {
  if (USE_DYNAMODB) {
    return await dynamoDB.getFileForAdmin(fileId)
  } else {
    const db = getJSONDB()
    if (!db.files) return null
    return db.files.find(f => f.id === fileId) || null
  }
}

export async function getProjectForAdmin(projectId) {
  if (USE_DYNAMODB) {
    return await dynamoDB.getProjectForAdmin(projectId)
  } else {
    const db = getJSONDB()
    if (!db.projects) return null
    return db.projects.find(p => p.id === projectId) || null
  }
}

export async function deleteUserFile(username, fileId) {
  if (USE_DYNAMODB) {
    return await dynamoDB.deleteFile(username, fileId)
  } else {
    const db = getJSONDB()
    if (!db.files) db.files = []
    
    db.files = db.files.filter(f => f.id !== fileId)
    saveJSONDB(db)
    return true
  }
}

export async function getUserJobs(username) {
  if (USE_DYNAMODB) {
    // Jobs could be stored as a separate entity type in DynamoDB
    // For now, return empty array as jobs are typically ephemeral
    return []
  } else {
    const db = getJSONDB()
    return db.jobs || []
  }
}

export async function saveUserJob(username, jobId, jobData) {
  if (USE_DYNAMODB) {
    // Jobs are typically ephemeral - could be stored in DynamoDB with TTL
    // For now, just log it
    console.log(`Job ${jobId} for user ${username}:`, jobData)
    return true
  } else {
    const db = getJSONDB()
    if (!db.jobs) db.jobs = []
    
    const existingIndex = db.jobs.findIndex(j => j.id === jobId)
    const job = { ...jobData, id: jobId, updatedAt: new Date().toISOString() }
    
    if (existingIndex >= 0) {
      db.jobs[existingIndex] = job
    } else {
      db.jobs.push(job)
    }
    
    saveJSONDB(db)
    return true
  }
}

// Migration helper
export async function migrateToUserStorage(username) {
  if (USE_DYNAMODB) {
    console.log(`Migrating JSON data to DynamoDB for user: ${username}`)
    
    const jsonDB = getJSONDB()
    
    // Migrate projects
    if (jsonDB.projects && jsonDB.projects.length > 0) {
      for (const project of jsonDB.projects) {
        const projectId = project.id || `project_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        await saveUserProject(username, projectId, project)
      }
      console.log(`Migrated ${jsonDB.projects.length} projects`)
    }
    
    // Migrate files/media
    if (jsonDB.files && jsonDB.files.length > 0) {
      for (const file of jsonDB.files) {
        const mediaId = file.id || `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        await saveMediaMetadata(username, mediaId, file)
      }
      console.log(`Migrated ${jsonDB.files.length} media entries`)
    }
    
    // Create backup
    const backupPath = DB_PATH + `.backup.${Date.now()}`
    fs.copyFileSync(DB_PATH, backupPath)
    console.log(`Created backup: ${backupPath}`)
    
    return true
  }
  return false
}
