// routes/videos.js
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getUploadSignature,
  saveVideo,
  getVideos,
  getVideo,
  deleteVideo,
  streamVideo,
  assignVideo,
  getViewers,
  updateVideo
} = require('../controllers/videoController');

/**
 * @swagger
 * tags:
 *   name: Videos
 *   description: Video upload, management, streaming and assignment
 */

/**
 * @swagger
 * /api/videos/upload-signature:
 *   get:
 *     summary: Get a signed payload for direct browser-to-Cloudinary upload
 *     tags: [Videos]
 *     description: >
 *       Returns a short-lived Cloudinary signature. The browser uses this to
 *       POST the video file directly to Cloudinary — the file never passes
 *       through this server. After Cloudinary confirms the upload, call
 *       POST /api/videos/save with the returned metadata.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Signed upload payload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 signature:  { type: string }
 *                 timestamp:  { type: number }
 *                 folder:     { type: string, example: videoapp/videos }
 *                 eager:      { type: string }
 *                 cloudName:  { type: string }
 *                 apiKey:     { type: string }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get('/upload-signature', protect, authorize('editor', 'admin'), getUploadSignature);

/**
 * @swagger
 * /api/videos/save:
 *   post:
 *     summary: Save video metadata after a successful direct upload
 *     tags: [Videos]
 *     description: >
 *       Called by the frontend after Cloudinary confirms the upload.
 *       Saves the video record to MongoDB and enqueues the sensitivity
 *       analysis job. Real-time progress is emitted via Socket.io on the
 *       videoProgress event.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [publicId, videoUrl]
 *             properties:
 *               title:        { type: string, example: Product Demo }
 *               publicId:     { type: string, description: Cloudinary public ID }
 *               videoUrl:     { type: string, description: Cloudinary delivery URL }
 *               thumbnailUrl: { type: string }
 *               originalName: { type: string, example: demo.mp4 }
 *               mimetype:     { type: string, example: video/mp4 }
 *               size:         { type: number, description: File size in bytes }
 *     responses:
 *       201:
 *         description: Video saved and processing queued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: Upload saved, processing queued }
 *                 video:   { $ref: '#/components/schemas/Video' }
 *       400:
 *         description: Missing required fields
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/save', protect, authorize('editor', 'admin'), saveVideo);

/**
 * @swagger
 * /api/videos/viewers:
 *   get:
 *     summary: Get all users eligible for video assignment (viewers and editors)
 *     tags: [Videos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of assignable users
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/User' }
 */
router.get('/viewers', protect, authorize('editor', 'admin'), getViewers);

/**
 * @swagger
 * /api/videos:
 *   get:
 *     summary: Get videos visible to the authenticated user
 *     tags: [Videos]
 *     description: >
 *       Results are filtered by role automatically:
 *       admin sees all videos, editor sees own + assigned, viewer sees assigned only.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [processing, safe, flagged]
 *         description: Filter by processing status
 *     responses:
 *       200:
 *         description: Array of videos
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Video' }
 */
router.get('/', protect, getVideos);

/**
 * @swagger
 * /api/videos/{id}:
 *   get:
 *     summary: Get a single video by ID
 *     tags: [Videos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Video MongoDB ID
 *     responses:
 *       200:
 *         description: Video object
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Video' }
 *       404:
 *         description: Video not found or access denied
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get('/:id', protect, getVideo);

/**
 * @swagger
 * /api/videos/{id}/stream:
 *   get:
 *     summary: Get a signed HLS stream URL for a video
 *     tags: [Videos]
 *     description: >
 *       Returns a signed, time-limited HLS manifest URL (.m3u8) expiring in
 *       1 hour. Feed this URL directly to an HLS-capable player — hls.js,
 *       Cloudinary's player, or Safari's native video element.
 *       Cloudinary handles range requests, adaptive bitrate, and CDN delivery
 *       at the segment level. Only videos with status "safe" or "flagged" can
 *       be streamed — processing videos return 202.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Signed stream URL and metadata
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/StreamResponse' }
 *       202:
 *         description: Video is still processing
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Video not found or access denied
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get('/:id/stream', protect, streamVideo);

/**
 * @swagger
 * /api/videos/{id}:
 *   delete:
 *     summary: Delete a video and its Cloudinary asset
 *     tags: [Videos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Video deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: Video deleted successfully }
 *       404:
 *         description: Video not found or not owned by requester
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.delete('/:id', protect, authorize('editor', 'admin'), deleteVideo);

/**
 * @swagger
 * /api/videos/{id}/assign:
 *   post:
 *     summary: Assign a video to one or more viewers/editors
 *     tags: [Videos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userIds]
 *             properties:
 *               userIds:
 *                 type: array
 *                 items: { type: string }
 *                 example: ['664f1a2b3c4d5e6f7a8b9c0d']
 *     responses:
 *       200:
 *         description: Video assigned successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:    { type: string }
 *                 assignedTo: { type: array, items: { type: string } }
 *       400:
 *         description: One or more invalid user IDs
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/:id/assign', protect, authorize('editor', 'admin'), assignVideo);

/**
 * @swagger
 * /api/videos/{id}:
 *   patch:
 *     summary: Update video title
 *     tags: [Videos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title: { type: string, example: My Updated Title }
 *     responses:
 *       200:
 *         description: Video updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *                 video: { $ref: '#/components/schemas/Video' }
 *       404:
 *         description: Video not found or not owned by requester
 */
router.patch('/:id', protect, authorize('editor', 'admin'), updateVideo);

module.exports = router;