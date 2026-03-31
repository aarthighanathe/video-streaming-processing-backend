// tests/videos.test.js
const request = require('supertest')
const mongoose = require('mongoose')

process.env.MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://localhost:27017/videoapp_test'
process.env.JWT_SECRET = 'test_jwt_secret_32chars_minimum!!'
process.env.REFRESH_TOKEN_SECRET = 'test_refresh_secret_32chars_min!!'
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379'
process.env.CLOUDINARY_CLOUD_NAME = 'test_cloud'
process.env.CLOUDINARY_API_KEY = 'test_key'
process.env.CLOUDINARY_API_SECRET = 'test_secret'
process.env.NODE_ENV = 'test'

let app, server
let editorToken, viewerToken, adminToken
let createdVideoId

// ── Mock Cloudinary + BullMQ so tests don't need real credentials ──────────
jest.mock('../config/cloudinary', () => ({
  cloudinary: {
    utils: { api_sign_request: () => 'mock_signature' },
    uploader: { destroy: jest.fn().mockResolvedValue({ result: 'ok' }) },
    api: { resource: jest.fn().mockResolvedValue({ duration: 60, width: 1920, height: 1080, bit_rate: 5000000, bytes: 50000000, frame_rate: 30, audio: true, format: 'mp4' }) },
    url: jest.fn().mockReturnValue('https://res.cloudinary.com/test/video/upload/mock.mp4'),
  }
}))

jest.mock('../services/videoQueue', () => ({
  videoQueue: { add: jest.fn().mockResolvedValue({ id: 'mock_job' }) },
  startWorker: jest.fn(),
  closeQueue: jest.fn().mockResolvedValue(undefined),
}))

beforeAll(async () => {
  const mod = require('../server')
  app = mod.app
  server = mod.server
  await mongoose.connection.dropDatabase()

  // Register editor
  const editorRes = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Editor User', email: 'editor@example.com', password: 'password123' })
  // Manually promote to editor via mongoose (no admin yet)
  const User = require('../models/User')
  await User.findByIdAndUpdate(editorRes.body.user.id, { role: 'editor' })
  const editorLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'editor@example.com', password: 'password123' })
  editorToken = editorLogin.body.accessToken

  // Register viewer
  const viewerRes = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Viewer User', email: 'viewer@example.com', password: 'password123' })
  const viewerLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'viewer@example.com', password: 'password123' })
  viewerToken = viewerLogin.body.accessToken

  // Register admin
  const adminRes = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Admin User', email: 'admin@example.com', password: 'password123' })
  await User.findByIdAndUpdate(adminRes.body.user.id, { role: 'admin' })
  const adminLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@example.com', password: 'password123' })
  adminToken = adminLogin.body.accessToken
})

afterAll(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
})

// ─── Upload signature ──────────────────────────────────────────────────────
describe('GET /api/videos/upload-signature', () => {
  it('returns signature for editor', async () => {
    const res = await request(app)
      .get('/api/videos/upload-signature')
      .set('Authorization', `Bearer ${editorToken}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('signature')
    expect(res.body).toHaveProperty('timestamp')
    expect(res.body).toHaveProperty('cloudName')
  })

  it('denies viewer', async () => {
    const res = await request(app)
      .get('/api/videos/upload-signature')
      .set('Authorization', `Bearer ${viewerToken}`)

    expect(res.status).toBe(403)
  })

  it('denies unauthenticated', async () => {
    const res = await request(app).get('/api/videos/upload-signature')
    expect(res.status).toBe(401)
  })
})

// ─── Save video metadata ───────────────────────────────────────────────────
describe('POST /api/videos/save', () => {
  it('saves video and queues processing job', async () => {
    const res = await request(app)
      .post('/api/videos/save')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        title: 'Test Video',
        publicId: 'videoapp/videos/test123',
        videoUrl: 'https://res.cloudinary.com/test/video/upload/test123.mp4',
        thumbnailUrl: 'https://res.cloudinary.com/test/video/upload/so_5/test123.jpg',
        originalName: 'test.mp4',
        mimetype: 'video/mp4',
        size: 5242880
      })

    expect(res.status).toBe(201)
    expect(res.body.video.status).toBe('processing')
    expect(res.body.video.title).toBe('Test Video')
    createdVideoId = res.body.video._id

    // Verify queue job was enqueued
    const { videoQueue } = require('../services/videoQueue')
    expect(videoQueue.add).toHaveBeenCalledWith('process', expect.objectContaining({
      publicId: 'videoapp/videos/test123'
    }))
  })

  it('rejects missing publicId', async () => {
    const res = await request(app)
      .post('/api/videos/save')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ title: 'No Public ID', videoUrl: 'https://example.com/video.mp4' })

    expect(res.status).toBe(400)
  })
})

// ─── Get videos ────────────────────────────────────────────────────────────
describe('GET /api/videos', () => {
  it('editor sees their own videos', async () => {
    const res = await request(app)
      .get('/api/videos')
      .set('Authorization', `Bearer ${editorToken}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
  })

  it('viewer sees empty list (no assignments yet)', async () => {
    const res = await request(app)
      .get('/api/videos')
      .set('Authorization', `Bearer ${viewerToken}`)

    expect(res.status).toBe(200)
    expect(res.body.length).toBe(0)
  })

  it('admin sees all videos', async () => {
    const res = await request(app)
      .get('/api/videos')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.length).toBeGreaterThan(0)
  })

  it('filters by status', async () => {
    const res = await request(app)
      .get('/api/videos?status=processing')
      .set('Authorization', `Bearer ${editorToken}`)

    expect(res.status).toBe(200)
    res.body.forEach(v => expect(v.status).toBe('processing'))
  })
})

// ─── Get single video ──────────────────────────────────────────────────────
describe('GET /api/videos/:id', () => {
  it('editor can get their own video', async () => {
    const res = await request(app)
      .get(`/api/videos/${createdVideoId}`)
      .set('Authorization', `Bearer ${editorToken}`)

    expect(res.status).toBe(200)
    expect(res.body._id).toBe(createdVideoId)
  })

  it('viewer cannot get unassigned video', async () => {
    const res = await request(app)
      .get(`/api/videos/${createdVideoId}`)
      .set('Authorization', `Bearer ${viewerToken}`)

    expect(res.status).toBe(404)
  })
})

// ─── Update video title ────────────────────────────────────────────────────
describe('PATCH /api/videos/:id', () => {
  it('editor can rename their video', async () => {
    const res = await request(app)
      .patch(`/api/videos/${createdVideoId}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ title: 'Renamed Video' })

    expect(res.status).toBe(200)
    expect(res.body.video.title).toBe('Renamed Video')
  })

  it('rejects empty title', async () => {
    const res = await request(app)
      .patch(`/api/videos/${createdVideoId}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ title: '   ' })

    expect(res.status).toBe(400)
  })

  it('viewer cannot rename', async () => {
    const res = await request(app)
      .patch(`/api/videos/${createdVideoId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ title: 'Viewer Rename' })

    expect(res.status).toBe(403)
  })
})

// ─── Assign video ──────────────────────────────────────────────────────────
describe('POST /api/videos/:id/assign', () => {
  let viewerUserId

  beforeAll(async () => {
    const User = require('../models/User')
    const viewer = await User.findOne({ email: 'viewer@example.com' })
    viewerUserId = String(viewer._id)
  })

  it('editor can assign video to viewer', async () => {
    const res = await request(app)
      .post(`/api/videos/${createdVideoId}/assign`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ userIds: [viewerUserId] })

    expect(res.status).toBe(200)
    expect(res.body.assignedTo).toContain(viewerUserId)
  })

  it('viewer can now access the assigned video', async () => {
    const res = await request(app)
      .get(`/api/videos/${createdVideoId}`)
      .set('Authorization', `Bearer ${viewerToken}`)

    expect(res.status).toBe(200)
  })
})

// ─── Stream video ──────────────────────────────────────────────────────────
describe('GET /api/videos/:id/stream', () => {
  beforeAll(async () => {
    // Set video to 'safe' so it can be streamed
    const Video = require('../models/Video')
    await Video.findByIdAndUpdate(createdVideoId, { status: 'safe' })
  })

  it('returns stream URL for editor', async () => {
    const res = await request(app)
      .get(`/api/videos/${createdVideoId}/stream`)
      .set('Authorization', `Bearer ${editorToken}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('streamUrl')
    expect(res.body).toHaveProperty('expiresAt')
  })

  it('viewer can stream assigned video', async () => {
    const res = await request(app)
      .get(`/api/videos/${createdVideoId}/stream`)
      .set('Authorization', `Bearer ${viewerToken}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('streamUrl')
  })
})

// ─── Delete video ──────────────────────────────────────────────────────────
describe('DELETE /api/videos/:id', () => {
  it('viewer cannot delete', async () => {
    const res = await request(app)
      .delete(`/api/videos/${createdVideoId}`)
      .set('Authorization', `Bearer ${viewerToken}`)

    expect(res.status).toBe(403)
  })

  it('editor can delete their own video', async () => {
    const res = await request(app)
      .delete(`/api/videos/${createdVideoId}`)
      .set('Authorization', `Bearer ${editorToken}`)

    expect(res.status).toBe(200)
  })

  it('video is gone after deletion', async () => {
    const res = await request(app)
      .get(`/api/videos/${createdVideoId}`)
      .set('Authorization', `Bearer ${editorToken}`)

    expect(res.status).toBe(404)
  })
})