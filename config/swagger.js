// config/swagger.js
const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Video App API',
      version: '1.0.0',
      description: `
## Video Upload, Sensitivity Processing & Streaming API

This API provides:
- **Authentication** — JWT-based auth with refresh token rotation
- **Video Management** — upload, process, stream, and manage videos
- **Sensitivity Analysis** — automated content classification (safe / flagged)
- **Real-Time Updates** — Socket.io progress events during processing
- **Role-Based Access** — viewer / editor / admin permission tiers
- **Admin Panel** — user management and system-wide video access

### Authentication
All protected endpoints require a Bearer token in the Authorization header:
\`\`\`
Authorization: Bearer <accessToken>
\`\`\`
Access tokens expire in **15 minutes**. Use \`POST /api/auth/refresh\` to get a new one.
The refresh token is sent automatically via httpOnly cookie.

### Roles
| Role    | Can upload | Can stream assigned | Can manage users |
|---------|-----------|---------------------|-----------------|
| viewer  | No        | Yes                 | No              |
| editor  | Yes       | Yes (own + assigned)| No              |
| admin   | Yes       | Yes (all)           | Yes             |

### Real-Time Events (Socket.io)
Connect with: \`io(SERVER_URL, { auth: { token: '<accessToken>' } })\`

Event: \`videoProgress\`
\`\`\`json
{
  "videoId":  "abc123",
  "progress": 75,
  "message":  "Analysing content sensitivity...",
  "status":   "processing | safe | flagged",
  "sensitivity": { "score": 0.2, "details": "..." }
}
\`\`\`
      `
    },
    servers: [
      {
        url: process.env.API_URL || 'http://localhost:3000',
        description: 'Active server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Access token from /api/auth/login or /api/auth/refresh. Expires in 15 minutes.'
        }
      },
      schemas: {
        // ── User ────────────────────────────────────────────────────────
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '664f1a2b3c4d5e6f7a8b9c0d' },
            name: { type: 'string', example: 'Jane Smith' },
            email: { type: 'string', example: 'jane@example.com' },
            role: { type: 'string', enum: ['viewer', 'editor', 'admin'] },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        // ── Auth responses ───────────────────────────────────────────────
        AuthResponse: {
          type: 'object',
          properties: {
            accessToken: {
              type: 'string',
              description: 'Short-lived JWT (15 min). Store in memory, not localStorage.'
            },
            user: { $ref: '#/components/schemas/User' }
          }
        },
        // ── Video ────────────────────────────────────────────────────────
        Video: {
          type: 'object',
          properties: {
            _id: { type: 'string', example: '664f1a2b3c4d5e6f7a8b9c0d' },
            title: { type: 'string', example: 'Product Demo' },
            filename: { type: 'string', description: 'Cloudinary public ID' },
            originalName: { type: 'string', example: 'demo.mp4' },
            mimetype: { type: 'string', example: 'video/mp4' },
            size: { type: 'number', description: 'File size in bytes' },
            duration: { type: 'number', description: 'Duration in seconds' },
            status: {
              type: 'string',
              enum: ['processing', 'safe', 'flagged'],
              description: 'processing = analysis in progress, safe = cleared, flagged = sensitive content detected'
            },
            videoUrl: { type: 'string', description: 'Raw Cloudinary URL (for reference only)' },
            thumbnailUrl: { type: 'string', description: 'Thumbnail image URL' },
            sensitivity: {
              type: 'object',
              properties: {
                score: { type: 'number', minimum: 0, maximum: 1, example: 0.3 },
                details: { type: 'string', example: 'Safe — score: 0.1. No significant signals.' }
              }
            },
            uploadedBy: { $ref: '#/components/schemas/User' },
            assignedTo: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of user IDs who can view this video'
            },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        // ── Stream response ───────────────────────────────────────────────
        StreamResponse: {
          type: 'object',
          properties: {
            streamUrl: {
              type: 'string',
              description: 'Signed HLS manifest URL (.m3u8). Expires in 1 hour. Feed directly to an HLS-capable player (hls.js, Cloudinary player, Safari native).'
            },
            expiresAt: { type: 'number', description: 'Unix timestamp when the URL expires' },
            title: { type: 'string' },
            thumbnailUrl: { type: 'string' },
            duration: { type: 'number' }
          }
        },
        // ── Error ────────────────────────────────────────────────────────
        Error: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Access denied: insufficient permissions' }
          }
        }
      }
    },
    // Applied globally — every endpoint requires auth unless overridden
    security: [{ bearerAuth: [] }]
  },
  // Scan all route files for JSDoc @swagger blocks
  apis: ['./routes/*.js']
};

module.exports = swaggerJsdoc(options);