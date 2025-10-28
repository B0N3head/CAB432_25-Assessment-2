import { receiveRenderJobs, deleteRenderJob, getQueueDepth } from './queue.js'
import { buildFfmpegCommand, execFfmpegWithProgress } from './video.js'
import { presignDownload, presignUpload, uploadToS3 } from './s3.js'
import { saveUserJob } from './storage.js'
import config from './config.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Worker configuration
const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || '1', 10)
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10) // 5 seconds
const ENABLE_WORKER = process.env.ENABLE_RENDER_WORKER === 'true'

let activeJobs = 0
let workerRunning = false
let shutdownRequested = false

/**
 * Process a single render job
 */
async function processRenderJob(message) {
    const { job, receiptHandle, approximateReceiveCount } = message
    const { jobId, projectId, userId, username, files, timeline, preset, renditions, width, height } = job

    console.log(`\n[${WORKER_ID}] Processing job ${jobId} (attempt ${approximateReceiveCount})`)
    console.log(`   Project: ${projectId}, User: ${username}, Preset: ${preset}`)

    activeJobs++
    const startTime = Date.now()

    try {
        // Update job status to "processing"
        await saveUserJob(username, jobId, {
            projectId,
            ownerId: userId,
            status: 'processing',
            progress: 0,
            startedAt: startTime,
            workerId: WORKER_ID,
            attempt: approximateReceiveCount
        })

        // Prepare output path
        const outputFilename = `${jobId}.mp4`
        const outputPath = config.features.useS3
            ? `/tmp/${outputFilename}` // Temp file for S3 upload
            : path.join(__dirname, '..', 'data', 'outputs', outputFilename)

        // Ensure output directory exists
        const outputDir = path.dirname(outputPath)
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true })
        }

        // Build FFmpeg command
        console.log(`[${WORKER_ID}] Building FFmpeg command...`)
        
        // Build project object for FFmpeg command generation
        const project = {
            id: projectId,
            width: width || 1920,
            height: height || 1080,
            fps: 30,
            tracks: timeline || [],
            fitMode: 'fit-in'
        }

        const ffmpegArgs = await buildFfmpegCommand(project, files, {
            preset: preset || 'crispstream',
            renditions: renditions || ['1080p']
        })

        console.log(`[${WORKER_ID}] Starting FFmpeg render...`)
        console.log(`   FFmpeg args: ${ffmpegArgs.join(' ').slice(0, 200)}...`)

        // Execute FFmpeg with progress tracking
        const result = await execFfmpegWithProgress(ffmpegArgs, outputPath, jobId)

        console.log(`[${WORKER_ID}] FFmpeg completed successfully (exit code ${result.code})`)

        // Upload to S3 if configured
        let finalOutputPath = outputPath
        if (config.features.useS3) {
            console.log(`[${WORKER_ID}] Uploading to S3...`)
            const s3Key = `media/outputs/${userId}/${outputFilename}`

            await uploadToS3({
                key: s3Key,
                filePath: outputPath,
                contentType: 'video/mp4'
            })

            finalOutputPath = `/media/outputs/${userId}/${outputFilename}`

            // Clean up temp file
            try {
                fs.unlinkSync(outputPath)
                console.log(`[${WORKER_ID}] Cleaned up temp file`)
            } catch (cleanupError) {
                console.warn(`[${WORKER_ID}] Failed to clean up temp file:`, cleanupError)
            }
        }

        // Update job status to "completed"
        const completedAt = Date.now()
        const duration = Math.round((completedAt - startTime) / 1000)

        await saveUserJob(username, jobId, {
            projectId,
            ownerId: userId,
            status: 'completed',
            progress: 100,
            output: finalOutputPath,
            createdAt: job.createdAt || startTime,
            startedAt: startTime,
            completedAt,
            duration,
            workerId: WORKER_ID,
            code: result.code,
            stderr: result.stderr
        })

        console.log(`[${WORKER_ID}] Job ${jobId} completed in ${duration}s`)

        // Delete message from queue (success)
        await deleteRenderJob(receiptHandle)
        console.log(`[${WORKER_ID}] Removed job ${jobId} from queue`)

        activeJobs--
        return { success: true, jobId, duration }

    } catch (error) {
        console.error(`[${WORKER_ID}] Job ${jobId} failed:`, error)

        // Update job status to "failed"
        try {
            await saveUserJob(username, jobId, {
                projectId,
                ownerId: userId,
                status: 'failed',
                error: error.message,
                failedAt: Date.now(),
                workerId: WORKER_ID,
                attempt: approximateReceiveCount
            })
        } catch (dbError) {
            console.error(`[${WORKER_ID}] Failed to update job status:`, dbError)
        }

        activeJobs--

        // Let SQS handle retry logic (message will be redelivered or sent to DLQ)
        // Do NOT delete the message - it will be retried based on queue config
        throw error
    }
}

/**
 * Main worker loop
 */
async function workerLoop() {
    console.log(`\n[${WORKER_ID}] Starting render worker...`)
    console.log(`   Max concurrent jobs: ${MAX_CONCURRENT_JOBS}`)
    console.log(`   Poll interval: ${POLL_INTERVAL_MS}ms`)

    workerRunning = true

    while (!shutdownRequested) {
        try {
            // Check if we can accept more jobs
            if (activeJobs >= MAX_CONCURRENT_JOBS) {
                console.log(`[${WORKER_ID}] At capacity (${activeJobs}/${MAX_CONCURRENT_JOBS}), waiting...`)
                await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
                continue
            }

            // Get queue depth for monitoring
            const queueDepth = await getQueueDepth()
            if (queueDepth.waiting > 0) {
                console.log(`[${WORKER_ID}] Queue: ${queueDepth.waiting} waiting, ${queueDepth.inProgress} in progress`)
            }

            // Receive jobs from queue
            const maxMessages = Math.min(MAX_CONCURRENT_JOBS - activeJobs, 1) // Process one at a time for now
            const messages = await receiveRenderJobs(maxMessages, 20) // 20s long polling

            if (messages.length === 0) {
                // No messages, long polling will handle the wait
                continue
            }

            // Process jobs (could be parallel if MAX_CONCURRENT_JOBS > 1)
            for (const message of messages) {
                // Don't await here if you want parallel processing
                await processRenderJob(message)
            }

        } catch (error) {
            console.error(`[${WORKER_ID}] Worker loop error:`, error)
            // Wait before retrying to avoid tight error loop
            await new Promise(resolve => setTimeout(resolve, 5000))
        }
    }

    console.log(`[${WORKER_ID}] Worker stopped`)
    workerRunning = false
}

/**
 * Graceful shutdown handler
 */
function setupShutdownHandlers() {
    const shutdown = async (signal) => {
        console.log(`\n[${WORKER_ID}] Received ${signal}, shutting down gracefully...`)
        shutdownRequested = true

        // Wait for active jobs to complete (with timeout)
        const maxWaitTime = 30000 // 30 seconds
        const startTime = Date.now()

        while (activeJobs > 0 && (Date.now() - startTime) < maxWaitTime) {
            console.log(`[${WORKER_ID}] Waiting for ${activeJobs} active job(s) to complete...`)
            await new Promise(resolve => setTimeout(resolve, 1000))
        }

        if (activeJobs > 0) {
            console.warn(`[${WORKER_ID}] Force shutdown with ${activeJobs} job(s) still active`)
        } else {
            console.log(`[${WORKER_ID}] All jobs completed, shutting down cleanly`)
        }

        process.exit(0)
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
}

/**
 * Start the worker
 */
export function startWorker() {
    if (!ENABLE_WORKER) {
        console.log('Render worker disabled (set ENABLE_RENDER_WORKER=true to enable)')
        return
    }

    if (workerRunning) {
        console.warn('Worker already running')
        return
    }

    setupShutdownHandlers()
    workerLoop().catch(error => {
        console.error('Worker crashed:', error)
        process.exit(1)
    })
}

/**
 * Stop the worker
 */
export function stopWorker() {
    shutdownRequested = true
}

// Auto-start worker if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    console.log('Video Render Worker')
    startWorker()
}
