import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import config from './config.js'
import fs from 'fs/promises'
import path from 'path'

let dynamoClient, dynamoDoc

function getDynamoDB() {
  if (!dynamoClient) {
    // Configure DynamoDB client - will use IAM instance role when deployed
    const clientConfig = { 
      region: config.region 
    }
    
    // Only add credentials if they exist (for local development)
    if (config.aws?.accessKeyId && config.aws?.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey
      }
    }
    
    dynamoClient = new DynamoDBClient(clientConfig)
    dynamoDoc = DynamoDBDocumentClient.from(dynamoClient)
    console.log('DynamoDB configured with region:', config.region, 
                'using IAM role:', !config.aws?.accessKeyId)
  }
  return dynamoDoc
}

// DynamoDB table name - using QUT username as specified
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'n11590041-video-editor-data'

// Data structure for video editor storage
export class VideoEditorDB {
  constructor() {
    this.client = getDynamoDB()
  }

  // User data operations
  async getUserData(username) {
    try {
      const command = new GetCommand({
        TableName: TABLE_NAME,
        Key: { 
          PK: `USER#${username}`,
          SK: 'PROFILE'
        }
      })
      const result = await this.client.send(command)
      return result.Item ? result.Item.data : null
    } catch (error) {
      console.error('Error getting user data:', error)
      throw error
    }
  }

  async saveUserData(username, data) {
    try {
      const command = new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${username}`,
          SK: 'PROFILE',
          data,
          updatedAt: new Date().toISOString()
        }
      })
      await this.client.send(command)
      return true
    } catch (error) {
      console.error('Error saving user data:', error)
      throw error
    }
  }

  // Video project operations
  async getProject(username, projectId) {
    try {
      const command = new GetCommand({
        TableName: TABLE_NAME,
        Key: { 
          PK: `USER#${username}`,
          SK: `PROJECT#${projectId}`
        }
      })
      const result = await this.client.send(command)
      return result.Item ? result.Item.project : null
    } catch (error) {
      console.error('Error getting project:', error)
      throw error
    }
  }

  async saveProject(username, projectId, projectData) {
    try {
      const command = new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${username}`,
          SK: `PROJECT#${projectId}`,
          project: projectData,
          updatedAt: new Date().toISOString(),
          GSI1PK: `PROJECT#${projectId}`,
          GSI1SK: username
        }
      })
      await this.client.send(command)
      return true
    } catch (error) {
      console.error('Error saving project:', error)
      throw error
    }
  }

  async getUserProjects(username) {
    try {
      const command = new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${username}`,
          ':sk': 'PROJECT#'
        }
      })
      const result = await this.client.send(command)
      return result.Items ? result.Items.map(item => ({
        id: item.SK.replace('PROJECT#', ''),
        ...item.project
      })) : []
    } catch (error) {
      console.error('Error getting user projects:', error)
      throw error
    }
  }

  async deleteProject(username, projectId) {
    try {
      const command = new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { 
          PK: `USER#${username}`,
          SK: `PROJECT#${projectId}`
        }
      })
      await this.client.send(command)
      return true
    } catch (error) {
      console.error('Error deleting project:', error)
      throw error
    }
  }

  // Media metadata operations (track what's in S3)
  async saveMediaMetadata(username, mediaId, metadata) {
    try {
      const command = new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `USER#${username}`,
          SK: `MEDIA#${mediaId}`,
          metadata,
          uploadedAt: new Date().toISOString(),
          GSI1PK: `MEDIA#${mediaId}`,
          GSI1SK: username
        }
      })
      await this.client.send(command)
      return true
    } catch (error) {
      console.error('Error saving media metadata:', error)
      throw error
    }
  }

  async getMediaMetadata(username, mediaId) {
    try {
      const command = new GetCommand({
        TableName: TABLE_NAME,
        Key: { 
          PK: `USER#${username}`,
          SK: `MEDIA#${mediaId}`
        }
      })
      const result = await this.client.send(command)
      return result.Item ? result.Item.metadata : null
    } catch (error) {
      console.error('Error getting media metadata:', error)
      throw error
    }
  }

  async getUserMedia(username) {
    try {
      const command = new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${username}`,
          ':sk': 'MEDIA#'
        }
      })
      const result = await this.client.send(command)
      return result.Items ? result.Items.map(item => ({
        id: item.SK.replace('MEDIA#', ''),
        ...item.metadata
      })) : []
    } catch (error) {
      console.error('Error getting user media:', error)
      throw error
    }
  }
}

// Migration utility to move from db.json to DynamoDB
export async function migrateFromJsonToDynamoDB(jsonFilePath = './db.json') {
  console.log('Starting migration from JSON to DynamoDB...')
  
  try {
    // Read existing db.json
    const jsonData = await fs.readFile(jsonFilePath, 'utf8')
    const data = JSON.parse(jsonData)
    
    const db = new VideoEditorDB()
    let migratedUsers = 0
    let migratedProjects = 0
    
    // Migrate each user's data
    for (const [username, userData] of Object.entries(data)) {
      console.log(`Migrating user: ${username}`)
      
      // Extract projects from user data
      const projects = userData.projects || []
      const userProfile = { ...userData }
      delete userProfile.projects
      
      // Save user profile
      await db.saveUserData(username, userProfile)
      migratedUsers++
      
      // Save each project
      for (const project of projects) {
        const projectId = project.id || `project_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        await db.saveProject(username, projectId, project)
        migratedProjects++
        console.log(`  - Migrated project: ${project.name || projectId}`)
      }
    }
    
    // Create backup of original file
    const backupPath = `${jsonFilePath}.backup.${Date.now()}`
    await fs.copyFile(jsonFilePath, backupPath)
    
    console.log(`✅ Migration complete!`)
    console.log(`   - Users migrated: ${migratedUsers}`)
    console.log(`   - Projects migrated: ${migratedProjects}`)
    console.log(`   - Original file backed up to: ${backupPath}`)
    
    return {
      success: true,
      migratedUsers,
      migratedProjects,
      backupPath
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error)
    throw error
  }
}

export default VideoEditorDB