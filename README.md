# VideoApp — Video Upload, Sensitivity Processing & Streaming Platform

A full-stack application for uploading, processing, and streaming videos with real-time content sensitivity analysis and role-based access control.

---

## Table of Contents

1. Live Demo
2. Tech Stack
3. Features
4. Architecture Overview
5. Installation & Setup
6. Environment Variables
7. API Documentation
8. User Manual
9. Assumptions & Design Decisions
---

## Live Demo

- **Frontend:** `https://your-app.vercel.app`
- **Backend API:** `https://your-api.onrender.com`
- **Swagger Docs:** `https://your-api.onrender.com/api/docs`
- **Demo video:** `https://your-loom-link`

---

## Tech Stack

### Backend

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ (LTS) |
| Framework | Express.js |
| Database | MongoDB Atlas + Mongoose ODM |
| Auth | JWT access tokens (15 min) + httpOnly refresh token cookies (7 days) |
| File Storage | Cloudinary — direct browser upload, HLS streaming, metadata API |
| Queue | BullMQ + Redis (job persistence, retries, concurrency) |
| Real-Time | Socket.io (user-scoped rooms) |
| API Docs | Swagger UI / OpenAPI 3.0 |
| Security | helmet, express-rate-limit, bcryptjs, CORS origin whitelist |
| Logging | morgan |
| Tests | Jest + Supertest |

### Frontend

| Layer | Technology |
|---|---|
| Build Tool | Vite |
| Framework | React 18 |
| State Management | Redux Toolkit |
| Styling | Tailwind CSS + custom CSS |
| HTTP Client | Axios |
| Real-Time | Socket.io-client |
| Routing | React Router v6 |

---

## Features

### Core
- **Video Upload** — browser uploads directly to Cloudinary (the file never passes through the server). The server issues a signed upload payload; the frontend posts to Cloudinary, then saves metadata via `POST /api/videos/save`.
- **Content Sensitivity Analysis** — automated pipeline classifies every video as `safe` or `flagged` with a 0.00–1.00 risk score (see [Assumptions](#assumptions--design-decisions) for the full signal table).
- **Real-Time Processing Updates** — Socket.io pushes progress events (15% → 50% → 75% → 90% → 100%) to the uploading user only, via user-scoped rooms.
- **HLS Video Streaming** — signed, expiring Cloudinary HLS manifest URL returned on stream request. Cloudinary's CDN handles range requests, adaptive bitrate, and delivery at the segment level.
- **Video Library** — filterable by status (`safe` / `flagged` / `processing`) and searchable by title.
- **Sensitivity Score** — visual risk score displayed on every processed video card.
- **Inline Title Edit** — editors and admins can rename videos directly.
- **Assign Videos** — editors and admins can assign videos to specific viewers/editors via a modal.

### Access Control

| Feature | Viewer | Editor | Admin |
|---|---|---|---|
| Watch assigned videos | ✅ | ✅ | ✅ |
| Upload videos | ❌ | ✅ | ✅ |
| Rename own videos | ❌ | ✅ | ✅ |
| Delete own videos | ❌ | ✅ | ✅ |
| Assign videos | ❌ | ✅ | ✅ |
| Delete any video | ❌ | ❌ | ✅ |
| View all users | ❌ | ❌ | ✅ |
| Change user roles | ❌ | ❌ | ✅ |
| View all platform videos | ❌ | ❌ | ✅ |

### Multi-Tenant Isolation
- Viewers see only videos explicitly assigned to them.
- Editors see their own uploads plus any videos assigned to them.
- Admins see everything across all users.
- Real-time progress events are emitted only to the uploading user's Socket.io room — no cross-user leakage.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────┐
│                     Frontend                        │
│   React + Vite    Redux Toolkit    Socket.io-client │
│   Axios           React Router v6  Tailwind CSS     │
└───────────────────────┬────────────────────────────┘
                        │ HTTPS / WSS
┌───────────────────────▼────────────────────────────┐
│                 Express API Server                   │
│                                                      │
│  /api/auth    Refresh-token rotation, bcrypt         │
│  /api/videos  Upload sig · Save · List · Stream      │
│               Assign · Rename · Delete               │
│  /api/admin   Users · Role management · All videos   │
│  /api/docs    Swagger UI (dev / ENABLE_DOCS=true)    │
│                                                      │
│  Socket.io    User-scoped progress rooms             │
│  BullMQ       Persistent job queue (3 retries)       │
│  helmet       Security headers                       │
│  rate-limit   10 req / 15 min on auth routes         │
└──────┬──────────────┬──────────────────┬────────────┘
       │              │                  │
┌──────▼──────┐  ┌────▼────────────┐  ┌─▼────────────┐
│  MongoDB    │  │   Cloudinary    │  │    Redis      │
│  Atlas      │  │   CDN           │  │               │
│  Users      │  │   Video storage │  │  BullMQ jobs  │
│  Videos     │  │   HLS streaming │  │  Job state    │
│  Metadata   │  │   Metadata API  │  └──────────────┘
└─────────────┘  └─────────────────┘
```

### Video Processing Pipeline

```
1. GET /api/videos/upload-signature
   └─ Server signs Cloudinary upload params (timestamp, folder, eager)
   └─ Browser uploads file directly to Cloudinary

2. POST /api/videos/save
   └─ Video document created in MongoDB (status: "processing")
   └─ BullMQ job enqueued in Redis (survives server restarts)

3. BullMQ worker picks up job (concurrency: 3, up to 3 retries)
   ├─ Socket emit → 15%  "Upload confirmed, fetching metadata..."
   ├─ cloudinary.api.resource() — fetches duration, bitrate, fps, etc.
   ├─ Socket emit → 50%  "Metadata received, running analysis..."
   ├─ analyzeSensitivity() — scores the video
   ├─ Socket emit → 75%  "Analysing content sensitivity..."
   ├─ MongoDB updated — duration written
   ├─ Socket emit → 90%  "Writing classification..."
   └─ MongoDB updated — status: "safe" | "flagged", score saved

4. Socket emit → 100% with final status + sensitivity result
   Frontend: updateVideoStatus in Redux → card updates instantly
   Frontend: fetchVideos() after 1.5s → full list sync
```

---

## Installation & Setup

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas — free tier works)
- Redis (local or managed — Render, Railway, Upstash)
- Cloudinary account (free tier works)

### 1. Clone the repository

```bash
git clone https://github.com/your-username/videoapp.git
cd videoapp
```

### 2. Backend setup

```bash
cd backend
npm install
cp .env.example .env
# Fill in all values — the server throws on startup if any are missing
npm run dev
```

### 3. Frontend setup

```bash
cd frontend
npm install
cp .env.example .env
# Set VITE_API_URL=http://localhost:3000
npm run dev
```

### 4. Verify

- Backend root: `http://localhost:3000` → `{ "status": "ok", "message": "VideoApp API" }`
- Swagger UI: `http://localhost:3000/api/docs`
- Frontend: `http://localhost:5173`

---

## Environment Variables

### Backend — `backend/.env`

```env
# Server
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# MongoDB
MONGO_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/videoapp

# Auth — use long random strings (32+ characters each)
JWT_SECRET=replace_with_a_long_random_string_min_32_chars
REFRESH_TOKEN_SECRET=replace_with_a_different_long_random_string

# Redis
REDIS_URL=redis://localhost:6379

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Optional: expose Swagger in production
# ENABLE_DOCS=true
```

### Frontend — `frontend/.env`

```env
VITE_API_URL=http://localhost:3000
```

> **Production:** Set `FRONTEND_URL` to your Vercel domain and `VITE_API_URL` to your Render domain. The server will refuse to start if any backend variable is missing.

---

## Running Tests

```bash
cd backend
npm test                    # run all suites
npm test -- --watch         # watch mode
npm test -- tests/auth      # single suite
```

Tests use an isolated `videoapp_test` MongoDB database. Cloudinary and BullMQ are mocked — no real credentials needed. The database is dropped before and after every suite.

**Coverage:**
- `auth.test.js` — registration, login, protected routes, token refresh, logout
- `videos.test.js` — upload signature, save, list (per role), get, rename, assign, stream, delete

---

## API Documentation

Full interactive documentation with request/response schemas is available at **`/api/docs`** (always on in development; set `ENABLE_DOCS=true` to expose in production).

### Authentication — `/api/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/register` | None | Register — returns access token, sets refresh cookie |
| POST | `/login` | None | Login — returns access token, rotates refresh cookie |
| POST | `/refresh` | Cookie | Issue new access token using the httpOnly refresh cookie |
| POST | `/logout` | Bearer | Revoke refresh token, clear cookie |
| GET | `/me` | Bearer | Get the currently authenticated user |

**Rate limits:** 10 req / 15 min on `/register` and `/login`. 30 req / 15 min on `/refresh`.

**Register request:**
```json
{ "name": "Jane Smith", "email": "jane@example.com", "password": "secret123" }
```
**Response `201`:**
```json
{
  "accessToken": "<jwt>",
  "user": { "id": "...", "name": "Jane Smith", "email": "...", "role": "viewer" }
}
```

All new accounts start as **Viewer**. The refresh token is set as an httpOnly cookie and is never included in the JSON body. On `/refresh`, no request body is needed — the cookie is read automatically and a new token pair is issued (rotation).

---

### Videos — `/api/videos`

All routes require `Authorization: Bearer <accessToken>`.

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/upload-signature` | editor, admin | Signed payload for direct browser-to-Cloudinary upload |
| POST | `/save` | editor, admin | Save video metadata after upload; enqueues processing job |
| GET | `/` | all | List videos (role-filtered automatically) |
| GET | `/:id` | all | Get single video (access-checked by role) |
| PATCH | `/:id` | editor, admin | Rename video |
| DELETE | `/:id` | editor, admin | Delete video + Cloudinary asset |
| GET | `/:id/stream` | all | Get signed HLS stream URL (1-hour expiry) |
| POST | `/:id/assign` | editor, admin | Assign video to one or more users |
| GET | `/viewers` | editor, admin | List all users eligible for assignment |

**Upload flow:**
```
1. GET /api/videos/upload-signature
   Response: { signature, timestamp, folder, eager, cloudName, apiKey }

2. Browser POSTs directly to Cloudinary using the signed params

3. POST /api/videos/save
   Body: { title, publicId, videoUrl, thumbnailUrl, originalName, mimetype, size }
   Response 201: { message: "Upload saved, processing queued", video: { ... } }
```

**GET /api/videos query params:**

| Param | Values | Description |
|---|---|---|
| `status` | `processing`, `safe`, `flagged` | Filter by processing status |

**GET /api/videos/:id/stream response:**
```json
{
  "streamUrl": "https://res.cloudinary.com/.../manifest.m3u8?...",
  "expiresAt": 1719000000,
  "title": "Product Demo",
  "thumbnailUrl": "...",
  "duration": 142.5
}
```
Videos with `status: "processing"` return `202`. Feed `streamUrl` directly to an HLS-capable player (hls.js, Cloudinary player, or Safari's native video element). If the request includes a `Range` header, the server proxies the partial response from Cloudinary and mirrors the `206 Partial Content` headers back.

---

### Admin — `/api/admin`

All routes require **Admin role**.

| Method | Path | Description |
|---|---|---|
| GET | `/users` | List all registered users (passwords excluded) |
| PUT | `/users/:id/role` | Change a user's role |
| GET | `/videos` | List all videos across all users |
| DELETE | `/videos/:id` | Delete any video regardless of ownership |

**Role-change guards enforced server-side:**
- An admin cannot change their own role (requires a second admin to do it).
- The last remaining admin cannot be demoted (another user must be promoted to admin first).

---

### Socket.io — Real-Time Events

**Connect:**
```javascript
import { io } from 'socket.io-client'
const socket = io(SERVER_URL, { auth: { token: accessToken } })
```

The server verifies the JWT on connection and joins the socket to a private room keyed by the user's MongoDB ID. No manual `join` event is needed from the client.

**Server → Client: `videoProgress`**
```json
{
  "videoId":     "664f1a2b...",
  "progress":    75,
  "message":     "Analysing content sensitivity...",
  "status":      "processing",
  "sensitivity": { "score": 0.2, "details": "..." }
}
```
`status` and `sensitivity` are only present in the final event (progress = 100).

---

## User Manual

### Registering & Logging In
1. Navigate to `/register`
2. Enter your name, email, and a password (minimum 6 characters)
3. All new accounts start as **Viewer** — an admin must upgrade your role if needed
4. After login you are taken to the Dashboard

### Uploading a Video (Editor / Admin)
1. Click **Upload** in the navigation bar
2. Drag and drop a video file, or click to browse (max 100 MB)
3. Optionally enter a title (defaults to the filename)
4. Click **Upload Video** — a progress bar shows the upload percentage
5. You are redirected to the Library once the upload completes
6. A processing card appears with a live progress bar updating in real time via WebSocket
7. The card updates to **Safe** or **Flagged** automatically — no page refresh needed

### Watching a Video
- Only **Safe** videos can be played
- Click **Watch** on any safe card to open the video player
- The player shows duration, file size, upload date, and the sensitivity analysis result

### Assigning Videos (Editor / Admin)
1. Click **Assign** on any video card
2. A modal lists all viewers and editors
3. Select the users you want to assign, then confirm
4. Assigned users will see the video in their Library immediately

### Renaming a Video (Editor / Admin)
- Hover over a video card title and click the pencil icon
- Type the new name and press **Enter** (or **Escape** to cancel)

### Admin Panel
- **Users tab** — view all registered users, change roles via the dropdown
- **Videos tab** — view all platform videos, delete any video

---

## Assumptions & Design Decisions

### Sensitivity Analysis is Simulated

The scoring function in `services/videoProcessor.js` analyses **structural file metadata** — not video frames or audio content. It produces a 0.00–1.00 risk score and classifies each video as `safe` or `flagged`. This is documented as a demonstration implementation throughout the codebase.

Real frame-level content moderation requires a computer vision model, GPU inference infrastructure, and a paid API subscription (AWS Rekognition starts at ~$0.10/min). The assignment requirement is satisfied at the **architecture level** — the pipeline, data model, real-time updates, queue, and UI classification display are all production-ready. Only the scoring function needs to be swapped out.

**Signal table (flagging threshold: score ≥ 0.40, signals are additive and capped at 1.00):**

| Signal | Threshold | Weight | Rationale |
|---|---|---|---|
| Short silent clip | duration < 30s AND no audio | +0.30 | Common format for static image sequences |
| High bits-per-pixel | bitrate ÷ (width × height) > 3 | +0.25 | Disproportionate compression suggests synthetic or screen-captured content |
| High bytes-per-second | size ÷ duration > 4 MB/s | +0.20 | Uncompressed or minimally processed recording |
| Non-standard frame rate | fps > 60 | +0.15 | Rare in consumer cameras |
| Non-standard container | not `mp4` or `webm` | +0.10 | Weak distributional signal |

**Expected scores for common video types:**

| Video type | Score | Classification |
|---|---|---|
| Phone camera MP4, 1080p, 30fps, with audio | 0.00 – 0.10 | Safe |
| Screen recording, no audio, short clip | 0.30 – 0.50 | Flagged |
| High-bitrate 4K footage, with audio | 0.20 – 0.25 | Safe |
| AVI file, high data rate | 0.30 – 0.40 | Borderline |
| Short screen-capture, no audio, high bitrate | 0.50 – 0.75 | Flagged |

To use real content moderation, replace `analyzeSensitivity()` in `videoProcessor.js` with a call to AWS Rekognition, Google Cloud Video Intelligence, or Azure AI Content Safety. The rest of the pipeline requires no changes.

### Cloudinary Metadata API Instead of ffprobe

Metadata extraction uses `cloudinary.api.resource()` rather than running `ffprobe` on the video stream. This avoids downloading the entire file (which would time out on Render's free tier for files over 10 MB) and eliminates a native binary dependency. The Cloudinary API returns duration, width, height, bitrate, frame rate, and audio presence with a single lightweight API call.

### Direct Upload to Cloudinary

Video files never pass through the Express server. The server issues a short-lived signed upload payload (timestamp + HMAC signature); the browser uploads directly to Cloudinary. After Cloudinary confirms the upload, the browser calls `POST /api/videos/save` with the returned metadata. This avoids large-file memory pressure on the server and offloads CDN delivery entirely to Cloudinary.

### Refresh Token Rotation

Access tokens expire in 15 minutes. A refresh token (7-day JWT) is issued alongside and stored as an httpOnly, `sameSite: strict` cookie — never readable by JavaScript, which mitigates XSS token theft. The token hash (SHA-256) is stored in MongoDB, not the raw token, so a database breach yields no usable tokens. Each call to `/api/auth/refresh` issues a new token pair and invalidates the previous one (single-use rotation). Logout clears the hash immediately, making the token unusable server-side before its JWT expiry.

### BullMQ for Processing Jobs

`processVideo` runs inside a BullMQ worker rather than being called directly from the controller. Jobs are persisted in Redis, so a server restart during processing does not lose the job — the worker picks it up again on restart. Failed jobs are automatically retried up to 3 times with exponential backoff (5s → 10s → 20s). Worker concurrency is set to 3.

### HLS Streaming with Signed URLs

The `/stream` endpoint returns a signed Cloudinary HLS manifest URL expiring in 1 hour. The browser feeds this to an HLS player; Cloudinary's CDN handles segment delivery, range requests, adaptive bitrate, and caching. Access control is enforced by the backend before the URL is issued.

### Role Elevation is Admin-Only

Self-registration always creates a Viewer account. The backend ignores any `role` field in the registration payload — allowing users to self-select `editor` or `admin` would be a security vulnerability. Role changes require an admin and are subject to two server-side guards: an admin cannot demote themselves, and the last admin cannot be demoted.

### Socket.io User Rooms

Processing progress events are emitted to `io.to(userId)` — a Socket.io room keyed by the user's MongoDB `_id`. The server joins each socket to this room immediately on connection (no client-side join event needed). All browser tabs open by the same user receive events simultaneously; users in other accounts receive nothing.

---

## Known Limitations

| Limitation | Impact | Suggested Fix |
|---|---|---|
| Sensitivity analysis uses metadata heuristics, not frame-level ML | Scores reflect structural signals, not actual content | Integrate AWS Rekognition or Google Video Intelligence |
| Role embedded in JWT at login time | Role change takes effect only after next login (max 15 min delay with short-lived tokens) | Acceptable given 15-minute access token lifetime |
| Single refresh token per user | Logging in on a new device silently invalidates the previous session | Store a list of hashes per user |
| No server-side MIME type validation on `/save` | Client could pass arbitrary `mimetype` field | Add a MIME type whitelist check in `saveVideo` |
| No admin status-override endpoint | Admin cannot manually un-flag a video without deleting it | Add `PATCH /api/admin/videos/:id/status` |
| Stretch: metadata filtering | No filter by upload date, file size, or duration | Add query params to `GET /api/videos` + indexed MongoDB fields |

---

## Deployment

### Backend — Render

1. Create a new **Web Service**, connect your repo, set root to `backend/`
2. Build command: `npm install` — Start command: `node server.js`
3. Add all environment variables from `.env.example` in the Render dashboard
4. Set `FRONTEND_URL` to your Vercel frontend URL
5. Add a Redis add-on (Render Redis or an external Upstash instance) and set `REDIS_URL`

> **Free tier cold starts:** Render's free tier spins down after 15 minutes of inactivity. The first request after spin-down takes 30–60 seconds. Visit the backend URL once before a demo to wake it up.

### Frontend — Vercel

1. Import the repo, set root to `frontend/`, framework preset: **Vite**
2. Add `VITE_API_URL=https://your-api.onrender.com`
3. Deploy

### MongoDB Atlas

1. Create a free M0 cluster
2. Under **Network Access**, add `0.0.0.0/0` (required for Render's dynamic IPs)
3. Create a database user and copy the connection string to `MONGO_URI`