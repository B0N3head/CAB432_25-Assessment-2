import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs'
import config from './config.js'

const sqsClient = new SQSClient({ region: config.region })

// Queue URLs - will be initialized from environment variables or created
let RENDER_QUEUE_URL = process.env.SQS_RENDER_QUEUE_URL || null
let DLQ_URL = process.env.SQS_DLQ_URL || null

/**
 * Initialize queue URLs from environment or queue names
 */
async function initializeQueues() {
    if (!RENDER_QUEUE_URL && process.env.SQS_RENDER_QUEUE_NAME) {
        try {
            const command = new GetQueueUrlCommand({ QueueName: process.env.SQS_RENDER_QUEUE_NAME })
            const response = await sqsClient.send(command)
            RENDER_QUEUE_URL = response.QueueUrl
            console.log(`Initialized render queue: ${RENDER_QUEUE_URL}`)
        } catch (error) {
            console.error('Failed to get render queue URL:', error)
        }
    }

    if (!DLQ_URL && process.env.SQS_DLQ_NAME) {
        try {
            const command = new GetQueueUrlCommand({ QueueName: process.env.SQS_DLQ_NAME })
            const response = await sqsClient.send(command)
            DLQ_URL = response.QueueUrl
            console.log(`Initialized DLQ: ${DLQ_URL}`)
        } catch (error) {
            console.error('Failed to get DLQ URL:', error)
        }
    }
}

// Initialize on module load
initializeQueues().catch(console.error)

/**
 * Enqueue a render job
 * @param {Object} jobData - Render job data
 * @returns {Promise<Object>} - SQS message response
 */
export async function enqueueRenderJob(jobData) {
    if (!RENDER_QUEUE_URL) {
        throw new Error('SQS render queue not configured. Set SQS_RENDER_QUEUE_URL or SQS_RENDER_QUEUE_NAME')
    }

    const messageBody = JSON.stringify({
        jobId: jobData.jobId,
        projectId: jobData.projectId,
        userId: jobData.userId,
        username: jobData.username,
        files: jobData.files,
        timeline: jobData.timeline,
        preset: jobData.preset || 'crispstream',
        renditions: jobData.renditions || ['1080p'],
        width: jobData.width || 1920,
        height: jobData.height || 1080,
        createdAt: Date.now(),
        retryCount: 0
    })

    const command = new SendMessageCommand({
        QueueUrl: RENDER_QUEUE_URL,
        MessageBody: messageBody,
        MessageAttributes: {
            jobId: {
                DataType: 'String',
                StringValue: jobData.jobId
            },
            userId: {
                DataType: 'String',
                StringValue: jobData.userId
            },
            projectId: {
                DataType: 'String',
                StringValue: jobData.projectId
            },
            priority: {
                DataType: 'Number',
                StringValue: (jobData.priority || 5).toString() // 1-10, lower = higher priority
            }
        }
    })

    try {
        const response = await sqsClient.send(command)
        console.log(`Enqueued render job ${jobData.jobId} for project ${jobData.projectId}`)
        return {
            success: true,
            messageId: response.MessageId,
            jobId: jobData.jobId
        }
    } catch (error) {
        console.error(`Failed to enqueue job ${jobData.jobId}:`, error)
        throw error
    }
}

/**
 * Receive render jobs from queue
 * @param {number} maxMessages - Maximum number of messages to receive (1-10)
 * @param {number} waitTimeSeconds - Long polling wait time (0-20)
 * @returns {Promise<Array>} - Array of job messages
 */
export async function receiveRenderJobs(maxMessages = 1, waitTimeSeconds = 20) {
    if (!RENDER_QUEUE_URL) {
        throw new Error('SQS render queue not configured')
    }

    const command = new ReceiveMessageCommand({
        QueueUrl: RENDER_QUEUE_URL,
        MaxNumberOfMessages: Math.min(maxMessages, 10),
        WaitTimeSeconds: Math.min(waitTimeSeconds, 20),
        VisibilityTimeout: 900, // 15 minutes - should be > max render time
        MessageAttributeNames: ['All'],
        AttributeNames: ['All']
    })

    try {
        const response = await sqsClient.send(command)
        const messages = response.Messages || []

        if (messages.length > 0) {
            console.log(`Received ${messages.length} render job(s) from queue`)
        }

        return messages.map(msg => ({
            messageId: msg.MessageId,
            receiptHandle: msg.ReceiptHandle,
            job: JSON.parse(msg.Body),
            attributes: msg.MessageAttributes || {},
            approximateReceiveCount: parseInt(msg.Attributes?.ApproximateReceiveCount || '0', 10)
        }))
    } catch (error) {
        console.error('Failed to receive messages from queue:', error)
        throw error
    }
}

/**
 * Delete a message from the queue after successful processing
 * @param {string} receiptHandle - Receipt handle from received message
 * @returns {Promise<void>}
 */
export async function deleteRenderJob(receiptHandle) {
    if (!RENDER_QUEUE_URL) {
        throw new Error('SQS render queue not configured')
    }

    const command = new DeleteMessageCommand({
        QueueUrl: RENDER_QUEUE_URL,
        ReceiptHandle: receiptHandle
    })

    try {
        await sqsClient.send(command)
        console.log('Deleted message from queue after successful processing')
    } catch (error) {
        console.error('Failed to delete message from queue:', error)
        throw error
    }
}

/**
 * Get queue depth (number of messages waiting)
 * @returns {Promise<Object>} - Queue statistics
 */
export async function getQueueDepth() {
    if (!RENDER_QUEUE_URL) {
        throw new Error('SQS render queue not configured')
    }

    const command = new GetQueueAttributesCommand({
        QueueUrl: RENDER_QUEUE_URL,
        AttributeNames: [
            'ApproximateNumberOfMessages',
            'ApproximateNumberOfMessagesNotVisible',
            'ApproximateNumberOfMessagesDelayed'
        ]
    })

    try {
        const response = await sqsClient.send(command)
        const attrs = response.Attributes || {}

        return {
            waiting: parseInt(attrs.ApproximateNumberOfMessages || '0', 10),
            inProgress: parseInt(attrs.ApproximateNumberOfMessagesNotVisible || '0', 10),
            delayed: parseInt(attrs.ApproximateNumberOfMessagesDelayed || '0', 10),
            total: parseInt(attrs.ApproximateNumberOfMessages || '0', 10) +
                parseInt(attrs.ApproximateNumberOfMessagesNotVisible || '0', 10)
        }
    } catch (error) {
        console.error('Failed to get queue depth:', error)
        throw error
    }
}

/**
 * Get DLQ depth (failed jobs)
 * @returns {Promise<Object>} - DLQ statistics
 */
export async function getDLQDepth() {
    if (!DLQ_URL) {
        return { waiting: 0, total: 0 }
    }

    const command = new GetQueueAttributesCommand({
        QueueUrl: DLQ_URL,
        AttributeNames: ['ApproximateNumberOfMessages']
    })

    try {
        const response = await sqsClient.send(command)
        const attrs = response.Attributes || {}

        return {
            waiting: parseInt(attrs.ApproximateNumberOfMessages || '0', 10),
            total: parseInt(attrs.ApproximateNumberOfMessages || '0', 10)
        }
    } catch (error) {
        console.error('Failed to get DLQ depth:', error)
        return { waiting: 0, total: 0 }
    }
}

/**
 * Receive messages from DLQ for manual inspection/retry
 * @param {number} maxMessages - Maximum number of messages to receive
 * @returns {Promise<Array>} - Array of failed job messages
 */
export async function receiveDLQMessages(maxMessages = 10) {
    if (!DLQ_URL) {
        throw new Error('DLQ not configured')
    }

    const command = new ReceiveMessageCommand({
        QueueUrl: DLQ_URL,
        MaxNumberOfMessages: Math.min(maxMessages, 10),
        WaitTimeSeconds: 1,
        MessageAttributeNames: ['All'],
        AttributeNames: ['All']
    })

    try {
        const response = await sqsClient.send(command)
        const messages = response.Messages || []

        return messages.map(msg => ({
            messageId: msg.MessageId,
            receiptHandle: msg.ReceiptHandle,
            job: JSON.parse(msg.Body),
            attributes: msg.MessageAttributes || {},
            approximateReceiveCount: parseInt(msg.Attributes?.ApproximateReceiveCount || '0', 10),
            sentTimestamp: parseInt(msg.Attributes?.SentTimestamp || '0', 10)
        }))
    } catch (error) {
        console.error('Failed to receive DLQ messages:', error)
        throw error
    }
}

/**
 * Delete a message from DLQ
 * @param {string} receiptHandle - Receipt handle from received message
 * @returns {Promise<void>}
 */
export async function deleteDLQMessage(receiptHandle) {
    if (!DLQ_URL) {
        throw new Error('DLQ not configured')
    }

    const command = new DeleteMessageCommand({
        QueueUrl: DLQ_URL,
        ReceiptHandle: receiptHandle
    })

    try {
        await sqsClient.send(command)
        console.log('Deleted message from DLQ')
    } catch (error) {
        console.error('Failed to delete DLQ message:', error)
        throw error
    }
}

/**
 * Retry a failed job from DLQ
 * @param {string} receiptHandle - Receipt handle from DLQ message
 * @param {Object} jobData - Job data from DLQ
 * @returns {Promise<Object>}
 */
export async function retryFailedJob(receiptHandle, jobData) {
    try {
        // Increment retry count
        const updatedJob = {
            ...jobData,
            retryCount: (jobData.retryCount || 0) + 1,
            retriedAt: Date.now()
        }

        // Re-enqueue to main queue
        await enqueueRenderJob(updatedJob)

        // Delete from DLQ
        await deleteDLQMessage(receiptHandle)

        console.log(`Retried job ${jobData.jobId} from DLQ (retry #${updatedJob.retryCount})`)

        return {
            success: true,
            jobId: jobData.jobId,
            retryCount: updatedJob.retryCount
        }
    } catch (error) {
        console.error(`Failed to retry job ${jobData.jobId}:`, error)
        throw error
    }
}

/**
 * Check if SQS is configured and ready
 * @returns {boolean}
 */
export function isQueueConfigured() {
    return RENDER_QUEUE_URL !== null
}

/**
 * Get queue configuration info
 * @returns {Object}
 */
export function getQueueConfig() {
    return {
        configured: isQueueConfigured(),
        renderQueueUrl: RENDER_QUEUE_URL,
        dlqUrl: DLQ_URL,
        region: config.region
    }
}
