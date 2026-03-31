// server.js
const dotenv = require('dotenv')
dotenv.config()

const REQUIRED_ENV = [
  'MONGO_URI', 'JWT_SECRET', 'REFRESH_TOKEN_SECRET',
  'REDIS_URL', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'
]
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`)
}

const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const http = require('http')
const helmet = require('helmet')
const morgan = require('morgan')
const jwt = require('jsonwebtoken')
const cookieParser = require('cookie-parser')
const { Server } = require('socket.io')
const swaggerUi = require('swagger-ui-express')
const swaggerSpec = require('./config/swagger')

const { setIo } = require('./services/videoProcessor')
const { startWorker, closeQueue } = require('./services/videoQueue')
const { processVideo } = require('./services/videoProcessor')

const authRoutes = require('./routes/auth')
const videoRoutes = require('./routes/videos')
const adminRoutes = require('./routes/admin')

const app = express()
const server = http.createServer(app)

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'
const IS_PROD = process.env.NODE_ENV === 'production'

// ─── CORS ────────────────────────────────────────────────────────────────
// Allow both the production Vercel URL and localhost for dev
const allowedOrigins = [
  FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean)

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true)
    if (allowedOrigins.includes(origin)) return callback(null, true)
    callback(new Error(`CORS blocked: ${origin}`))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}

// ─── Security ────────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: IS_PROD ? undefined : false,  // relax CSP in dev
}))

app.use(cors(corsOptions))
// app.options('*', cors(corsOptions))  // handle preflight for all routes
app.options('/{*splat}', cors(corsOptions))

app.use(IS_PROD ? morgan('combined') : morgan('dev'))
app.use(express.json({ limit: '10mb' }))  // JSON only — videos go direct to Cloudinary
app.use(cookieParser())

// ─── Trust proxy (required for Render / Heroku for rate limiting) ────────
// Without this, express-rate-limit sees the load balancer IP, not the real client.
app.set('trust proxy', 1)

// ─── Socket.io ───────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: corsOptions.origin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Increase ping timeout for slow connections
  pingTimeout: 60000,
  pingInterval: 25000,
})

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token
    if (!token) return next(new Error('Authentication required'))
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    socket.user = decoded
    next()
  } catch {
    next(new Error('Token invalid or expired'))
  }
})

setIo(io)

io.on('connection', (socket) => {
  const userId = String(socket.user.id)
  socket.join(userId)
  console.log(`[Socket] ${socket.id} connected (user: ${userId})`)

  socket.on('disconnect', (reason) => {
    console.log(`[Socket] ${socket.id} disconnected: ${reason}`)
  })
})

// ─── Routes ───────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({
  status: 'ok',
  message: 'VideoApp API',
  version: '1.0.0',
  env: process.env.NODE_ENV,
}))

// Swagger — only expose in non-production or if explicitly enabled
if (!IS_PROD || process.env.ENABLE_DOCS === 'true') {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'VideoApp API Docs',
    swaggerOptions: { persistAuthorization: true }
  }))
  app.get('/api/docs.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.json(swaggerSpec)
  })
}

app.use('/api/auth', authRoutes)
app.use('/api/videos', videoRoutes)
app.use('/api/admin', adminRoutes)

// ─── 404 handler ─────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found' })
})

// ─── Global error handler ─────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  // Don't leak stack traces in production
  console.error('[Error]', err.message)
  if (IS_PROD) {
    res.status(err.status || 500).json({ message: err.message || 'Internal server error' })
  } else {
    res.status(err.status || 500).json({ message: err.message, stack: err.stack })
  }
})

// ─── Connect DB and start server ─────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
})
  .then(() => {
    console.log('[DB] MongoDB connected')
    startWorker(processVideo)  // ← after DB is ready
    if (process.env.NODE_ENV !== 'test') {
      const PORT = process.env.PORT || 3000
      server.listen(PORT, '0.0.0.0', () => {
        console.log(`[Server] Running on port ${PORT} (${process.env.NODE_ENV})`)
      })
    }
  })
  .catch((err) => {
    console.error('[DB] Connection failed:', err.message)
    process.exit(1)
  })

// ─── Graceful shutdown ────────────────────────────────────────────────────
const shutdown = async (signal) => {
  console.log(`[Server] ${signal} received — shutting down`)
  await closeQueue()
  server.close(() => {
    mongoose.disconnect().then(() => process.exit(0))
  })
  // Force exit after 10s if graceful shutdown hangs
  setTimeout(() => process.exit(1), 10000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

module.exports = { app, server, io }