#!/usr/bin/env node
/**
 * Simple DynamoDB connection test for CAB432 Video Editor
 * Based on QUT CAB432 DynamoDB practical requirements
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import dotenv from 'dotenv'

dotenv.config()

// QUT CAB432 requirements: partition key must be 'qut-username' with your QUT username
const QUT_USERNAME = 'n11590041@qut.edu.au'
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'n11590041-video-editor-data'

async function testDynamoDBConnection() {
  console.log('Testing DynamoDB Connection')
  console.log('==============================')
  console.log(`Table: ${TABLE_NAME}`)
  console.log(`QUT Username: ${QUT_USERNAME}`)
  console.log(`AWS Region: ap-southeast-2`)
  console.log('')

  // Create DynamoDB client
  const client = new DynamoDBClient({ region: 'ap-southeast-2' })
  const docClient = DynamoDBDocumentClient.from(client)

  try {
    // Test 1: Put a test item
    console.log('Test 1: Writing test item...')
    const putCommand = new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        'qut-username': QUT_USERNAME,
        'SK': 'TEST#connection',
        'testData': {
          message: 'DynamoDB connection test successful',
          timestamp: new Date().toISOString(),
          version: '1.0.0'
        },
        'createdAt': new Date().toISOString()
      }
    })
    
    await docClient.send(putCommand)
    console.log('Write test successful!')
    
    // Test 2: Get the item back
    console.log('\nTest 2: Reading test item...')
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        'qut-username': QUT_USERNAME,
        'SK': 'TEST#connection'
      }
    })
    
    const getResult = await docClient.send(getCommand)
    if (getResult.Item) {
      console.log('Read test successful!')
      console.log('Retrieved item:', JSON.stringify(getResult.Item, null, 2))
    } else {
      console.log('Read test failed: No item found')
    }
    
    // Test 3: Query for items (using begins_with on sort key)
    console.log('\n🔍 Test 3: Querying items...')
    const queryCommand = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: '#pk = :username AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: {
        '#pk': 'qut-username',
        '#sk': 'SK'
      },
      ExpressionAttributeValues: {
        ':username': QUT_USERNAME,
        ':prefix': 'TEST#'
      }
    })
    
    const queryResult = await docClient.send(queryCommand)
    console.log('Query test successful!')
    console.log(`Found ${queryResult.Items.length} items matching query`)
    
    // Test 4: Write a more complex item (simulating video project data)
    console.log('\n🎬 Test 4: Writing video project item...')
    const projectData = {
      'qut-username': QUT_USERNAME,
      'SK': 'PROJECT#test-project-123',
      'project': {
        id: 'test-project-123',
        name: 'Test Video Project',
        description: 'A test project to verify DynamoDB integration',
        timeline: {
          tracks: [
            {
              type: 'video',
              clips: [
                { fileId: 'video1', start: 0, in: 0, out: 10 }
              ]
            }
          ]
        },
        settings: {
          width: 1920,
          height: 1080,
          fps: 30
        }
      },
      'GSI1PK': 'PROJECT#test-project-123',
      'GSI1SK': QUT_USERNAME,
      'createdAt': new Date().toISOString(),
      'updatedAt': new Date().toISOString()
    }
    
    const putProjectCommand = new PutCommand({
      TableName: TABLE_NAME,
      Item: projectData
    })
    
    await docClient.send(putProjectCommand)
    console.log('Video project write test successful!')
    
    console.log('\nAll DynamoDB tests passed!')
    console.log('=================================')
    console.log('Connection: Working')
    console.log('Read/Write: Working') 
    console.log('Queries: Working')
    console.log('Complex Data: Working')
    console.log('')
    console.log('Your DynamoDB integration is ready! 🚀')
    
  } catch (error) {
    console.error('\nDynamoDB test failed!')
    console.error('=======================')
    console.error('Error:', error.message)
    console.error('')
    
    if (error.name === 'ResourceNotFoundException') {
      console.error('Solution: Create the DynamoDB table first')
      console.error('   Table name should be:', TABLE_NAME)
      console.error('   Partition key: qut-username (String)')
      console.error('   Sort key: SK (String)')
    } else if (error.name === 'UnauthorizedOperation' || error.name === 'AccessDenied') {
      console.error('Solution: Check IAM permissions for DynamoDB')
      console.error('   Your EC2 instance needs DynamoDB read/write permissions')
    } else {
      console.error('Check the error details above for troubleshooting')
    }
    
    process.exit(1)
  }
}

// Run the test
testDynamoDBConnection().catch(console.error)