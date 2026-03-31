// tests/auth.test.js
const request = require('supertest')
const mongoose = require('mongoose')
const http = require('http')

// Point to a test DB — never run tests against production
process.env.MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://localhost:27017/videoapp_test'
process.env.JWT_SECRET = 'test_jwt_secret_32chars_minimum!!'
process.env.REFRESH_TOKEN_SECRET = 'test_refresh_secret_32chars_min!!'
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379'
process.env.CLOUDINARY_CLOUD_NAME = 'test_cloud'
process.env.CLOUDINARY_API_KEY = 'test_key'
process.env.CLOUDINARY_API_SECRET = 'test_secret'
process.env.NODE_ENV = 'test'

let app, server

beforeAll(async () => {
  // Import app after env vars are set
  const mod = require('../server')
  app = mod.app    // see note below — server.js needs to export app
  server = mod.server
  await mongoose.connection.dropDatabase()
})

afterAll(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
})

// ─── Registration ──────────────────────────────────────────────────────────
describe('POST /api/auth/register', () => {
  it('registers a new user and returns an accessToken', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test User', email: 'test@example.com', password: 'password123' })

    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('accessToken')
    expect(res.body.user.role).toBe('viewer')
    expect(res.body.user.email).toBe('test@example.com')
  })

  it('rejects duplicate email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Dupe', email: 'test@example.com', password: 'password123' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/already registered/i)
  })

  it('rejects short password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Short', email: 'short@example.com', password: '123' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/6 characters/i)
  })

  it('rejects invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Bad Email', email: 'not-an-email', password: 'password123' })

    expect(res.status).toBe(400)
  })
})

// ─── Login ─────────────────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  it('logs in with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password123' })

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('accessToken')
    // Refresh token should be in httpOnly cookie, not body
    expect(res.body).not.toHaveProperty('refreshToken')
    expect(res.headers['set-cookie']).toBeDefined()
  })

  it('rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpassword' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/invalid/i)
  })

  it('rejects unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'password123' })

    expect(res.status).toBe(400)
  })
})

// ─── Protected route ───────────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
  let token

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password123' })
    token = res.body.accessToken
  })

  it('returns current user with valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.email).toBe('test@example.com')
    expect(res.body).not.toHaveProperty('password')
    expect(res.body).not.toHaveProperty('refreshTokenHash')
  })

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('returns 401 with malformed token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer notavalidtoken')
    expect(res.status).toBe(401)
  })
})

// ─── Token refresh ─────────────────────────────────────────────────────────
describe('POST /api/auth/refresh', () => {
  it('issues new accessToken using refresh cookie', async () => {
    // Login to get the cookie
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password123' })

    const cookie = loginRes.headers['set-cookie']

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookie)

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('accessToken')
  })

  it('returns 401 without cookie', async () => {
    const res = await request(app).post('/api/auth/refresh')
    expect(res.status).toBe(401)
  })
})

// ─── Logout ────────────────────────────────────────────────────────────────
describe('POST /api/auth/logout', () => {
  it('clears the refresh cookie', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password123' })
    const token = loginRes.body.accessToken
    const cookie = loginRes.headers['set-cookie']

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookie)

    expect(res.status).toBe(200)
    // Cookie should be cleared (expires in the past)
    const setCookie = res.headers['set-cookie']?.[0] || ''
    expect(setCookie).toMatch(/refreshToken=;|Max-Age=0|Expires=Thu, 01 Jan 1970/)
  })
})