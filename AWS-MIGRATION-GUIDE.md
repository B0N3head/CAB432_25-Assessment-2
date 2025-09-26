# AWS S3 + DynamoDB Migration Guide

This guide will help you complete the S3 bucket integration and migrate to DynamoDB storage for your video editor application.

## 🔧 Current Issues Fixed

### 1. S3 Upload 403 Errors
- **Problem**: AWS credentials were set to placeholder values causing 403 Forbidden errors
- **Solution**: Updated code to use IAM instance roles instead of hardcoded credentials
- **Files Modified**: 
  - `server/.env` - Removed placeholder credentials
  - `server/src/s3.js` - Updated to use IAM roles
  - `server/src/config.js` - Added conditional credential handling

### 2. DynamoDB Integration Added
- **New Features**:
  - Full DynamoDB storage system with user-aware data partitioning
  - Migration utilities to move from `db.json` to DynamoDB
  - S3 storage for all media files, renders, and thumbnails

## 📋 Deployment Steps

### Step 1: Deploy DynamoDB Table

Run the deployment script to create your DynamoDB table:

```bash
# Using PowerShell (Windows)
cd "c:\New folder\CAB432_25-Assessment-2"
.\scripts\deploy-dynamodb.ps1

# Or using Bash (if available)
./scripts/deploy-dynamodb.sh
```

This creates a DynamoDB table named `n11590041-video-editor-data` with:
- Partition key: `PK` (User and resource type)
- Sort key: `SK` (Resource ID)
- GSI for cross-user queries
- Point-in-time recovery enabled

### Step 2: Install New Dependencies

Update your Docker container with the new DynamoDB dependencies:

```bash
cd server
npm install
```

### Step 3: Rebuild and Deploy

```bash
# Build new Docker image
docker compose build

# Deploy with the restart script
.\scripts\restart-docker.sh
```

### Step 4: Migrate Existing Data (Optional)

If you have existing data in `db.json`, migrate it to DynamoDB:

```bash
cd server
node scripts/migrate-to-dynamodb.js
```

## 🏗️ Architecture Changes

### Before (File-based)
```
📁 server/data/
  └── db.json (all user data)
📁 public/uploads/
  └── media files
```

### After (Cloud-native)
```
🗄️ DynamoDB Table: n11590041-video-editor-data
  ├── USER#username → User profiles
  ├── PROJECT#projectId → Video projects  
  └── MEDIA#mediaId → Media metadata

☁️ S3 Bucket: n11590041-media-dump
  ├── media/uploads/ → Original uploads
  ├── media/outputs/ → Rendered videos
  └── media/thumbnails/ → Video thumbnails
```

## 📊 Data Structure

### DynamoDB Schema
```javascript
// User Profile
{
  PK: "USER#n11590041",
  SK: "PROFILE", 
  data: { preferences, settings, ... }
}

// Video Project
{
  PK: "USER#n11590041",
  SK: "PROJECT#abc123",
  project: { name, timeline, tracks, ... },
  GSI1PK: "PROJECT#abc123",  // For cross-user queries
  GSI1SK: "n11590041"
}

// Media Metadata
{
  PK: "USER#n11590041", 
  SK: "MEDIA#xyz789",
  metadata: { filename, size, s3Key, ... },
  GSI1PK: "MEDIA#xyz789",
  GSI1SK: "n11590041"
}
```

### S3 Object Structure
```
s3://n11590041-media-dump/
├── media/uploads/n11590041/
│   ├── video1.mp4
│   ├── audio1.mp3
│   └── image1.jpg
├── media/outputs/n11590041/project123/
│   ├── 720p/video.mp4
│   ├── 1080p/video.mp4
│   └── 4k/video.mp4
└── media/thumbnails/n11590041/
    ├── video1/thumbnail.jpg
    └── video2/thumbnail.jpg
```

## 🔐 Security & Permissions

### IAM Role Permissions Needed
Your EC2 instance role (`CAB432-Instance-Role`) should have:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::n11590041-media-dump",
        "arn:aws:s3:::n11590041-media-dump/*"
      ]
    },
    {
      "Effect": "Allow", 
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": [
        "arn:aws:dynamodb:ap-southeast-2:*:table/n11590041-video-editor-data",
        "arn:aws:dynamodb:ap-southeast-2:*:table/n11590041-video-editor-data/index/*"
      ]
    }
  ]
}
```

## 🧪 Testing

### 1. Test S3 Uploads
1. Go to https://videoeditor.cab432.com
2. Try uploading a video file
3. Should now work without 403 errors

### 2. Test DynamoDB Storage  
1. Create a new project
2. Check DynamoDB console for new entries
3. Verify data is properly partitioned by user

### 3. Test Renders
1. Create a simple video project
2. Render it - should upload to S3 automatically
3. Check S3 console for rendered files in `media/outputs/`

## 📱 Monitoring

### CloudWatch Metrics
- DynamoDB: Read/Write capacity, throttles
- S3: Request metrics, data transfer
- EC2: CPU, memory usage

### Application Logs
```bash
# Check application logs
docker compose logs -f server

# Check for DynamoDB operations
docker compose logs server | grep DynamoDB

# Check for S3 operations  
docker compose logs server | grep S3
```

## 🔧 Troubleshooting

### Common Issues

1. **403 S3 Errors**
   - Verify IAM role permissions
   - Check bucket exists: `n11590041-media-dump`

2. **DynamoDB Access Denied**
   - Verify table exists: `n11590041-video-editor-data` 
   - Check IAM permissions for DynamoDB

3. **Migration Errors**
   - Ensure `db.json` exists and is valid JSON
   - Check DynamoDB table is created first

4. **Performance Issues**
   - Monitor DynamoDB capacity metrics
   - Consider using DynamoDB Auto Scaling

## 🚀 Production Optimizations

### Cost Optimization
- DynamoDB: Use On-Demand billing for variable workloads
- S3: Enable Intelligent Tiering for automatic cost optimization
- Consider S3 Lifecycle policies for old renders

### Performance
- Enable DynamoDB DAX for microsecond latency
- Use S3 Transfer Acceleration for global uploads
- Implement CloudFront CDN for media delivery

### Backup & Recovery
- DynamoDB: Point-in-time recovery enabled
- S3: Cross-region replication recommended for critical data
- Regular exports to S3 for long-term archival

## 📞 Support

If you encounter issues:
1. Check CloudWatch logs for detailed error messages
2. Verify IAM permissions are correctly configured
3. Test AWS credentials: `aws sts get-caller-identity`
4. Ensure all environment variables are set correctly

Your application is now fully cloud-native with scalable storage! 🎉