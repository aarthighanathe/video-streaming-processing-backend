// services/videoQueue.js
const { Queue, Worker, QueueEvents } = require('bullmq')
const IORedis = require('ioredis')

// ─── Single shared Redis connection ───────────────────────────────────────
// Previously this file created 4 separate connections (queue, queueEvents,
// worker, standalone). On free Redis tiers (Render, Railway) this hits the
// connection limit fast. BullMQ supports sharing a connection via the
// { connection } option — pass the same IORedis instance to all three.
//
// IMPORTANT: BullMQ requires maxRetriesPerRequest: null on the connection
// passed to Queue and Worker. The blocking commands the worker uses internally
// (BLPOP etc.) will throw otherwise.
const sharedConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  // Reconnect with capped exponential backoff — avoids hammering Redis on
  // transient connectivity blips (common on free-tier cloud Redis).
  retryStrategy: (times) => Math.min(times * 500, 5000),
})

sharedConnection.on('error', (err) => console.error('[Redis] Connection error:', err.message))
sharedConnection.on('connect', () => console.log('[Redis] Connected'))
sharedConnection.on('reconnecting', () => console.log('[Redis] Reconnecting...'))

// ─── Queue ────────────────────────────────────────────────────────────────
const videoQueue = new Queue('video-processing', {
  connection: sharedConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000   // 5s → 10s → 20s
    },
    removeOnComplete: 50,
    removeOnFail: 20,
  }
})

// ─── Queue Events (logging + monitoring) ──────────────────────────────────
// QueueEvents needs its own connection because it uses SUBSCRIBE mode,
// which puts the connection into a state incompatible with regular commands.
// This is the ONE case where a second connection is unavoidable with BullMQ.
const eventsConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy: (times) => Math.min(times * 500, 5000),
})

const queueEvents = new QueueEvents('video-processing', {
  connection: eventsConnection
})

queueEvents.on('completed', ({ jobId }) => console.log(`[Queue] Job ${jobId} completed`))
queueEvents.on('failed', ({ jobId, failedReason }) => console.error(`[Queue] Job ${jobId} failed: ${failedReason}`))
queueEvents.on('retrying', ({ jobId, error }) => console.warn(`[Queue] Job ${jobId} retrying: ${error}`))

// ─── Worker ───────────────────────────────────────────────────────────────
let workerInstance = null

const startWorker = (processVideoFn) => {
  workerInstance = new Worker(
    'video-processing',
    async (job) => {
      const { videoId, publicId, uploadedBy } = job.data
      console.log(`[Worker] Job ${job.id}: video ${videoId} (attempt ${job.attemptsMade + 1})`)
      await processVideoFn(videoId, publicId, uploadedBy)
    },
    {
      connection: sharedConnection,  // shares the same connection as the Queue
      concurrency: 3,
    }
  )

  workerInstance.on('error', (err) => console.error('[Worker] Error:', err.message))
  return workerInstance
}

// ─── Graceful shutdown ────────────────────────────────────────────────────
const closeQueue = async () => {
  if (workerInstance) await workerInstance.close()
  await videoQueue.close()
  await queueEvents.close()
  // Close both connections
  await sharedConnection.quit()
  await eventsConnection.quit()
  console.log('[Queue] Shut down cleanly')
}

module.exports = { videoQueue, sharedConnection, startWorker, closeQueue }