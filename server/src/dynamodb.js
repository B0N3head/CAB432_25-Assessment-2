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
        if (item.projectId) {
          projects[item.projectId] = item.projectData
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
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
        ExpressionAttributeNames: {
          '#pk': 'qut-username',
          '#sk': 'fileId'
        },
        ExpressionAttributeValues: {
          ':pk': username,
          ':sk': 'file#'
        }
      })

      const response = await this.docClient.send(command)
      
      // Transform DynamoDB items back to the expected format
      const files = []
      response.Items?.forEach(item => {
        if (item.fileData) {
          files.push(item.fileData)
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
          fileData: fileData,
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
