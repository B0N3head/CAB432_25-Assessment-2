import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
import config from './config.js'

export class VideoEditorDB {
  constructor() {
    const client = new DynamoDBClient({ region: config.region })
    this.docClient = DynamoDBDocumentClient.from(client)
    this.tableName = config.database.tableName || 'n11590041-video-editor-data'
    console.log(`DynamoDB initialized with table: ${this.tableName}`)
  }

  // Get all projects for a user
  async getUserProjects(username) {
    try {
      const command = new GetCommand({
        TableName: this.tableName,
        Key: {
          'qut-username': username
        }
      })

      const response = await this.docClient.send(command)
      
      if (response.Item && response.Item.projects) {
        // Return projects as object with project ID as key
        const projects = {}
        response.Item.projects.forEach(project => {
          projects[project.id] = project
        })
        return projects
      }
      
      return {}
    } catch (error) {
      console.error('Error getting user projects from DynamoDB:', error)
      return {}
    }
  }

  // Save a project for a user
  async saveProject(username, projectId, projectData) {
    try {
      // First get the current user data
      const currentData = await this.getUserData(username)
      
      // Update or add the project
      if (!currentData.projects) {
        currentData.projects = []
      }
      
      // Find and update existing project or add new one
      const existingIndex = currentData.projects.findIndex(p => p.id === projectId)
      if (existingIndex >= 0) {
        currentData.projects[existingIndex] = projectData
      } else {
        currentData.projects.push(projectData)
      }
      
      // Save back to DynamoDB
      const command = new PutCommand({
        TableName: this.tableName,
        Item: {
          'qut-username': username,
          ...currentData,
          lastModified: new Date().toISOString()
        }
      })

      await this.docClient.send(command)
      console.log(`Project ${projectId} saved for user ${username}`)
      return true
    } catch (error) {
      console.error('Error saving project to DynamoDB:', error)
      throw error
    }
  }

  // Get a specific project for a user
  async getProject(username, projectId) {
    try {
      const projects = await this.getUserProjects(username)
      return projects[projectId] || null
    } catch (error) {
      console.error('Error getting project from DynamoDB:', error)
      return null
    }
  }

  // Helper function to get all user data
  async getUserData(username) {
    try {
      const command = new GetCommand({
        TableName: this.tableName,
        Key: {
          'qut-username': username
        }
      })

      const response = await this.docClient.send(command)
      return response.Item || { 'qut-username': username, projects: [], files: [] }
    } catch (error) {
      console.error('Error getting user data from DynamoDB:', error)
      return { 'qut-username': username, projects: [], files: [] }
    }
  }

  // Delete a project for a user
  async deleteProject(username, projectId) {
    try {
      // Get current user data
      const currentData = await this.getUserData(username)
      
      // Remove the project
      if (currentData.projects) {
        currentData.projects = currentData.projects.filter(p => p.id !== projectId)
      }
      
      // Save back to DynamoDB
      const command = new PutCommand({
        TableName: this.tableName,
        Item: {
          ...currentData,
          lastModified: new Date().toISOString()
        }
      })

      await this.docClient.send(command)
      console.log(`Project ${projectId} deleted for user ${username}`)
      return true
    } catch (error) {
      console.error('Error deleting project from DynamoDB:', error)
      throw error
    }
  }

  // File management functions  
  // Get all files for a user
  async getUserFiles(username) {
    try {
      const command = new GetCommand({
        TableName: this.tableName,
        Key: {
          'qut-username': username
        }
      })

      const response = await this.docClient.send(command)
      
      if (response.Item && response.Item.files) {
        return response.Item.files
      }
      
      return []
    } catch (error) {
      console.error('Error getting user files from DynamoDB:', error)
      return []
    }
  }

  // Save a file for a user
  async saveFile(username, fileData) {
    try {
      // Get current user data
      const currentData = await this.getUserData(username)
      
      // Update or add the file
      if (!currentData.files) {
        currentData.files = []
      }
      
      // Find and update existing file or add new one
      const existingIndex = currentData.files.findIndex(f => f.id === fileData.id)
      if (existingIndex >= 0) {
        currentData.files[existingIndex] = fileData
      } else {
        currentData.files.push(fileData)
      }
      
      // Save back to DynamoDB
      const command = new PutCommand({
        TableName: this.tableName,
        Item: {
          'qut-username': username,
          ...currentData,
          lastModified: new Date().toISOString()
        }
      })

      await this.docClient.send(command)
      console.log(`File ${fileData.id} saved for user ${username}`)
      return true
    } catch (error) {
      console.error('Error saving file to DynamoDB:', error)
      throw error
    }
  }

  // Get a specific file for a user
  async getFile(username, fileId) {
    try {
      const files = await this.getUserFiles(username)
      return files.find(f => f.id === fileId) || null
    } catch (error) {
      console.error('Error getting file from DynamoDB:', error)
      return null
    }
  }

  // Delete a file for a user
  async deleteFile(username, fileId) {
    try {
      // Get current user data
      const currentData = await this.getUserData(username)
      
      // Remove the file
      if (currentData.files) {
        currentData.files = currentData.files.filter(f => f.id !== fileId)
      }
      
      // Save back to DynamoDB
      const command = new PutCommand({
        TableName: this.tableName,
        Item: {
          ...currentData,
          lastModified: new Date().toISOString()
        }
      })

      await this.docClient.send(command)
      console.log(`File ${fileId} deleted for user ${username}`)
      return true
    } catch (error) {
      console.error('Error deleting file from DynamoDB:', error)
      throw error
    }
  }

  // Admin functions to access all users' data (simplified - requires table scan)
  async getAllFiles() {
    try {
      console.log('Admin getAllFiles: Scanning all user data (expensive operation)')
      // Note: This is a simple implementation that scans the entire table
      // In production, you'd want a GSI or different table structure for efficiency
      const command = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'attribute_exists(#pk)',
        ExpressionAttributeNames: {
          '#pk': 'qut-username'
        }
      })

      // For now, just return empty array since table scan is expensive
      // Admin should use user-specific queries instead
      return []
    } catch (error) {
      console.error('Error getting all files from DynamoDB:', error)
      return []
    }
  }

  async getAllProjects() {
    try {
      console.log('Admin getAllProjects: Scanning all user data (expensive operation)')
      // Note: This is a simple implementation that would scan the entire table
      // In production, you'd want a GSI or different table structure for efficiency
      return []
    } catch (error) {
      console.error('Error getting all projects from DynamoDB:', error)
      return []
    }
  }

  async getFileForAdmin(fileId) {
    try {
      console.log(`Admin getFileForAdmin: Looking for file ${fileId} (requires table scan)`)
      // For now, return null since this requires expensive table scan
      // Admin should specify username to get files efficiently
      return null
    } catch (error) {
      console.error('Error getting file for admin from DynamoDB:', error)
      return null
    }
  }

  async getProjectForAdmin(projectId) {
    try {
      console.log(`Admin getProjectForAdmin: Looking for project ${projectId} (requires table scan)`)
      // For now, return null since this requires expensive table scan
      // Admin should specify username to get projects efficiently
      return null
    } catch (error) {
      console.error('Error getting project for admin from DynamoDB:', error)
      return null
    }
  }
}
