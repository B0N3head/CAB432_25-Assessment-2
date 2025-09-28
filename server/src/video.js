import { spawn } from 'child_process'
import { cacheSet } from './cache.js'
import path from 'path'
import fs from 'fs'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import config from './config.js'

export function execCmd(cmd, args){
  return new Promise((resolve, reject)=> {
    const child = spawn(cmd, args, { stdio:['ignore','pipe','pipe'] })
    let stdout='', stderr=''
    child.stdout.on('data', d=> stdout += d.toString())
    child.stderr.on('data', d=> stderr += d.toString())
    child.on('error', reject)
    child.on('close', code=> {
      if (code === 0) resolve({ code, stdout, stderr })
      else reject(new Error(`cmd failed (${code}): ${stderr}`))
    })
  })
}

export async function probeMedia(filepath){
  try {
    const { stdout } = await execCmd('ffprobe', ['-v','quiet','-print_format','json','-show_format','-show_streams', filepath])
    return JSON.parse(stdout)
  } catch (e) { return null }
}

// S3 client for uploading renders and thumbnails
let s3Client
function getS3Client() {
  if (!s3Client) {
    const clientConfig = { region: config.region }
    if (config.aws?.accessKeyId && config.aws?.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey
      }
    }
    s3Client = new S3Client(clientConfig)
  }
  return s3Client
}

// Upload file to S3 and return the S3 key
export async function uploadToS3(localFilePath, s3Key, contentType) {
  try {
    const fileBuffer = fs.readFileSync(localFilePath)
    
    const uploadCommand = new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: contentType,
      Metadata: {
        'upload-timestamp': new Date().toISOString(),
        'original-filename': path.basename(localFilePath)
      }
    })
    
    await getS3Client().send(uploadCommand)
    console.log(`Uploaded ${localFilePath} to S3: s3://${config.s3.bucket}/${s3Key}`)
    
    // Clean up local file after upload
    fs.unlinkSync(localFilePath)
    
    return {
      success: true,
      s3Key,
      bucket: config.s3.bucket,
      url: `https://${config.s3.bucket}.s3.${config.region}.amazonaws.com/${s3Key}`
    }
  } catch (error) {
    console.error('Error uploading to S3:', error)
    throw error
  }
}

export async function generateThumbnail(inputPath, username, videoId){
  const tempPath = `/tmp/thumb_${videoId}_${Date.now()}.jpg`
  await execCmd('ffmpeg', ['-y','-ss','1.0','-i',inputPath,'-frames:v','1', tempPath])
  
  // Upload thumbnail to S3
  const s3Key = `${config.s3.thumbsPrefix}${username}/${videoId}/thumbnail.jpg`
  const result = await uploadToS3(tempPath, s3Key, 'image/jpeg')
  
  return result
}

// Build an ffmpeg command that composes tracks by z-order (higher video tracks overlay on top).
export async function buildFfmpegCommand(project, files, options){
  // Force 16:9 aspect ratio for consistent output
  const width = 1920
  const height = 1080
  const { fps=30, tracks=[] } = project
  const { preset='crispstream', renditions=['1080p'] } = options || {}

  const videoClips = []
  const audioClips = []
  for (const t of tracks){
    for (const c of t.clips){
      const f = files.find(x=> x.id===c.fileId)
      if (!f) continue
      const clip = { ...c, path: f.path, mimetype: f.mimetype, name:f.name }
      if (t.type==='video') videoClips.push(clip)
      else if (t.type==='audio') audioClips.push(clip)
    }
  }

  let duration = 10
  for (const c of [...videoClips, ...audioClips]){
    duration = Math.max(duration, c.start + (c.out - c.in))
  }
  duration = Math.ceil(duration + 1)

  // Input 0: color background
  const inputArgs = ['-f','lavfi','-t', String(duration), '-r', String(fps), '-i', `color=c=black:s=${width}x${height}`]
  const filterGraphParts = []
  let vi = 1
  // We'll set the starting audio input index after pushing all video inputs
  let ai
  const vlabels = []
  const alabels = []

  for (const clip of videoClips){
    inputArgs.push('-i', clip.path)
    const vlabel = `v${vi}`
    // Improved scaling that maintains aspect ratio and centers content within 16:9
    filterGraphParts.push(`[${vi}:v]trim=start=${clip.in}:end=${clip.out},setpts=PTS-STARTPTS,scale='min(${width},iw*${height}/ih)':'min(${height},ih*${width}/iw)':eval=frame,pad=${width}:${height}:(${width}-iw)/2:(${height}-ih)/2:black,format=yuva420p,setpts=PTS+${clip.start}/TB[${vlabel}]`)
    vlabels.push(vlabel)
    vi += 1
  }

  // Audio inputs follow video inputs, so start audio index at the next available input index
  ai = vi

  let last = '0:v'
  let count = 1
  for (const vlabel of vlabels){
    const out = `base${count}`
    // Use overlay with 'enable' to only show during clip duration, preventing frame extension
    // The enable expression ensures overlay only happens during the clip's active time
    filterGraphParts.push(`[${last}][${vlabel}]overlay=format=auto:enable='between(t,${videoClips[count-1].start},${videoClips[count-1].start + (videoClips[count-1].out - videoClips[count-1].in)})'[${out}]`)
    last = out
    count += 1
  }
  const vOutLabel = last

  for (const clip of audioClips){
    inputArgs.push('-i', clip.path)
    const alabel = `a${ai}`
    const delayMs = Math.max(0, Math.floor(clip.start*1000))
    // Apply delay to all channels; use all=1 to replicate delay across channels
    filterGraphParts.push(`[${ai}:a]atrim=start=${clip.in}:end=${clip.out},asetpts=PTS-STARTPTS,adelay=${delayMs}:all=1[${alabel}]`)
    alabels.push(alabel)
    ai += 1
  }

  if (alabels.length>0){
    filterGraphParts.push(`${alabels.map(x=>`[${x}]`).join('')}amix=inputs=${alabels.length}:normalize=0[aout]`)
  }

  const filtergraph = filterGraphParts.join(';')

  // Choose encoder speed/quality
  let presetName = 'medium'
  let crf = 20

  // If user has selected a different preset, use the corresponding crf
  if (preset === 'fast') { presetName = 'veryfast'; crf = 23 }
  else if (preset === 'quality') { presetName = 'veryslow'; crf = 18 }

  const vcodec = ['-c:v','libx264','-preset', presetName, '-crf', String(crf), '-pix_fmt','yuv420p']
  const acodec = ['-c:a','aac','-b:a','192k']

  const args = []
  args.push(...inputArgs)
  args.push('-filter_complex', filtergraph)
  args.push('-map', `[${vOutLabel}]`)
  if (alabels.length>0) {
    args.push('-map', '[aout]')
    args.push(...acodec)
  } else {
    // No audio inputs; explicitly disable audio to avoid codec option errors
    args.push('-an')
  }
  args.push(...vcodec, '-movflags','+faststart')
  return args
}

export async function execFfmpeg(args, outPath){
  const finalArgs = ['-hide_banner', ...args, '-y', outPath]
  return execCmd('ffmpeg', finalArgs)
}

// Execute ffmpeg with progress parsing and store to cache under jobId
export function execFfmpegWithProgress(args, outPath, jobId) {
  return new Promise((resolve, reject) => {
    const finalArgs = ['-hide_banner', ...args, '-y', outPath]
    console.log('🎬 FFmpeg command:', 'ffmpeg', finalArgs.join(' '))
    
    const child = spawn('ffmpeg', finalArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', async (d) => {
      const s = d.toString()
      stderr += s
      // Basic parse: look for frame / time / speed
      const m = s.match(/time=([\d:.]+)/)
      if (m && jobId) {
        await cacheSet(`job:${jobId}`, { status: 'running', time: m[1], updatedAt: Date.now() }, 300)
      }
    })
    child.on('error', (error) => {
      console.error('🚨 FFmpeg process error:', error)
      reject(error)
    })
    child.on('close', async (code) => {
      if (jobId) await cacheSet(`job:${jobId}`, { status: code === 0 ? 'done' : 'error', code, updatedAt: Date.now() }, 600)
      if (code === 0) {
        console.log('✅ FFmpeg completed successfully')
        resolve({ code, stderr })
      } else {
        console.error('❌ FFmpeg failed with code:', code)
        console.error('❌ FFmpeg stderr:', stderr)
        reject(new Error(`ffmpeg failed (${code}): ${stderr}`))
      }
    })
  })
}

// Render video and upload to S3
export async function renderAndUploadVideo(project, files, options, username, projectId) {
  const { renditions = ['1080p'] } = options || {}
  const results = []
  
  for (const rendition of renditions) {
    console.log(`🎬 Starting render for ${rendition}...`)
    
    // Create temporary output file
    const tempOutputPath = `/tmp/render_${projectId}_${rendition}_${Date.now()}.mp4`
    
    try {
      // Build ffmpeg command
      const args = await buildFfmpegCommand(project, files, { ...options, renditions: [rendition] })
      
      // Execute ffmpeg render
      const jobId = `render_${projectId}_${rendition}_${Date.now()}`
      await execFfmpegWithProgress(args, tempOutputPath, jobId)
      
      // Upload to S3
      const s3Key = `${config.s3.outputsPrefix}${username}/${projectId}/${rendition}/video.mp4`
      const uploadResult = await uploadToS3(tempOutputPath, s3Key, 'video/mp4')
      
      results.push({
        rendition,
        ...uploadResult,
        jobId
      })
      
      console.log(`${rendition} render completed and uploaded`)
      
    } catch (error) {
      console.error(`Render failed for ${rendition}:`, error)
      
      // Clean up temp file if it exists
      if (fs.existsSync(tempOutputPath)) {
        fs.unlinkSync(tempOutputPath)
      }
      
      results.push({
        rendition,
        success: false,
        error: error.message
      })
    }
  }
  
  return results
}
