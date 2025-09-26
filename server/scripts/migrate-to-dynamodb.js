#!/usr/bin/env node
/**
 * Migration script to move from db.json file storage to DynamoDB
 * Usage: node migrate-to-dynamodb.js [path-to-db.json]
 */

import { migrateFromJsonToDynamoDB } from '../src/dynamodb.js'
import path from 'path'
import process from 'process'

const DB_FILE_PATH = process.argv[2] || path.join(process.cwd(), 'db.json')

console.log('🚀 Starting DynamoDB Migration')
console.log('================================')
console.log(`Source file: ${DB_FILE_PATH}`)
console.log(`DynamoDB table: ${process.env.DYNAMODB_TABLE_NAME || 'n11590041-video-editor-data'}`)
console.log('AWS Region:', process.env.AWS_REGION || 'ap-southeast-2')
console.log('')

try {
  const result = await migrateFromJsonToDynamoDB(DB_FILE_PATH)
  
  console.log('')
  console.log('🎉 Migration Summary:')
  console.log('====================')
  console.log(`✅ Users migrated: ${result.migratedUsers}`)
  console.log(`✅ Projects migrated: ${result.migratedProjects}`)
  console.log(`💾 Backup created: ${result.backupPath}`)
  console.log('')
  console.log('Next steps:')
  console.log('1. Verify data in DynamoDB console')
  console.log('2. Update your application to use DynamoDB instead of JSON file')
  console.log('3. Remove or archive the original db.json file')
  
} catch (error) {
  console.error('')
  console.error('❌ Migration failed:')
  console.error('===================')
  console.error(error.message)
  console.error('')
  console.error('Troubleshooting:')
  console.error('1. Check AWS credentials are configured')
  console.error('2. Verify DynamoDB table exists and has correct permissions')
  console.error('3. Ensure the source JSON file exists and is readable')
  
  process.exit(1)
}