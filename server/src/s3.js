import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import config from './config.js'

let s3
function getS3() {
  if (!s3) s3 = new S3Client({ region: config.region })
  return s3
}

export async function presignUpload({ key, contentType, expires = 900 }) {
  const cmd = new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, ContentType: contentType })
  const url = await getSignedUrl(getS3(), cmd, { expiresIn: expires })
  return { url, bucket: config.s3.bucket, key }
}

export async function presignDownload({ key, expires = 900 }) {
  const cmd = new GetObjectCommand({ Bucket: config.s3.bucket, Key: key })
  const url = await getSignedUrl(getS3(), cmd, { expiresIn: expires })
  return { url }
}
