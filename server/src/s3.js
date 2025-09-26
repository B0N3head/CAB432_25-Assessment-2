import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import config from './config.js'

let s3
function getS3() {
  if (!s3) {
    // Configure S3 client - will use IAM instance role when deployed
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
    
    s3 = new S3Client(clientConfig)
    console.log('S3Client configured with region:', config.region, 
                'using IAM role:', !config.aws?.accessKeyId)
  }
  return s3
}

export async function presignUpload({ key, contentType, expires = 900 }) {
  console.log('Attempting to create presigned URL for:', { key, contentType, bucket: config.s3.bucket })
  try {
    const cmd = new PutObjectCommand({ 
      Bucket: config.s3.bucket, 
      Key: key, 
      ContentType: contentType,
      // Add metadata for better tracking
      Metadata: {
        'upload-timestamp': new Date().toISOString(),
        'content-type': contentType
      }
    })
    console.log('S3 Command created, getting signed URL...')
    const url = await getSignedUrl(getS3(), cmd, { expiresIn: expires })
    console.log('Presigned URL created successfully')
    return { url, bucket: config.s3.bucket, key }
  } catch (error) {
    console.error('S3 presign error:', error)
    throw error
  }
}

export async function presignDownload({ key, expires = 900 }) {
  const cmd = new GetObjectCommand({ Bucket: config.s3.bucket, Key: key })
  const url = await getSignedUrl(getS3(), cmd, { expiresIn: expires })
  return { url }
}
