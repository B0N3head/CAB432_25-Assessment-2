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
}
