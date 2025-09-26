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
      const command = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk',
        FilterExpression: 'attribute_exists(projectId) AND NOT attribute_exists(fileId)',
        ExpressionAttributeNames: {
          '#pk': 'qut-username'
        },
        ExpressionAttributeValues: {
          ':pk': username
        }
      })

      const response = await this.docClient.send(command)
      
      // Transform DynamoDB items back to the expected format
      const projects = {}
      response.Items?.forEach(item => {
        if (item.projectId && !item.fileId) {
          if (item.projectData) {
            projects[item.projectId] = item.projectData
          } else {
            // Handle cases where project data is stored differently
            const projectData = { ...item }
            delete projectData['qut-username']
            delete projectData.projectId
            delete projectData.lastModified
            projects[item.projectId] = projectData
          }
        }
      })

      return projects
    } catch (error) {
      console.error('Error getting user projects from DynamoDB:', error)
      return {}
    }
  }

  // Save a project for a user
  async saveProject(username, projectId, projectData) {
    try {
      const command = new PutCommand({
        TableName: this.tableName,
        Item: {
          'qut-username': username,
          projectId: projectId,
          projectData: projectData,
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
      const command = new GetCommand({
        TableName: this.tableName,
        Key: {
          'qut-username': username,
          projectId: projectId
        }
      })

      const response = await this.docClient.send(command)
      return response.Item?.projectData || null
    } catch (error) {
      console.error('Error getting project from DynamoDB:', error)
      return null
    }
  }

  // Delete a project for a user
  async deleteProject(username, projectId) {
    try {
      const command = new DeleteCommand({
        TableName: this.tableName,
        Key: {
          'qut-username': username,
          projectId: projectId
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
      const command = new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: '#pk = :pk',
        FilterExpression: 'attribute_exists(#fileId)',
        ExpressionAttributeNames: {
          '#pk': 'qut-username',
          '#fileId': 'fileId'
        },
        ExpressionAttributeValues: {
          ':pk': username
        }
      })

      const response = await this.docClient.send(command)
      
      // Transform DynamoDB items back to the expected format
      const files = []
      response.Items?.forEach(item => {
        // Check if this item represents a file (has fileId attribute)
        if (item.fileId && item.fileId.startsWith('file#')) {
          if (item.fileData) {
            files.push(item.fileData)
          } else {
            // Handle cases where file data is stored differently
            const fileData = { ...item }
            delete fileData['qut-username']
            delete fileData.fileId
            delete fileData.lastModified
            files.push(fileData)
          }
        }
      })

      return files
    } catch (error) {
      console.error('Error getting user files from DynamoDB:', error)
      return []
    }
  }

  // Save a file for a user
  async saveFile(username, fileData) {
    try {
      const command = new PutCommand({
        TableName: this.tableName,
        Item: {
          'qut-username': username,
          fileId: `file#${fileData.id}`,
          // Store file attributes directly as top-level attributes for compatibility
          id: fileData.id,
          ownerId: fileData.ownerId,
          s3Key: fileData.s3Key,
          name: fileData.name,
          mimetype: fileData.mimetype,
          createdAt: fileData.createdAt,
          duration: fileData.duration,
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
      const command = new GetCommand({
        TableName: this.tableName,
        Key: {
          'qut-username': username,
          fileId: `file#${fileId}`
        }
      })

      const response = await this.docClient.send(command)
      return response.Item?.fileData || null
    } catch (error) {
      console.error('Error getting file from DynamoDB:', error)
      return null
    }
  }

  // Delete a file for a user
  async deleteFile(username, fileId) {
    try {
      const command = new DeleteCommand({
        TableName: this.tableName,
        Key: {
          'qut-username': username,
          fileId: `file#${fileId}`
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
}
