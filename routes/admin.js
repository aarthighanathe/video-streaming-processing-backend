// routes/admin.js
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getUsers,
  updateRole,
  getAllVideos,
  deleteVideo
} = require('../controllers/adminController');

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: User management and system-wide video access. Admin role required.
 */

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Get all registered users
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of all users (passwords excluded)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/User' }
 *       403:
 *         description: Admin role required
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get('/users', protect, authorize('admin'), getUsers);

/**
 * @swagger
 * /api/admin/users/{id}/role:
 *   put:
 *     summary: Update a user's role
 *     tags: [Admin]
 *     description: >
 *       Two guards are enforced:
 *       (1) An admin cannot change their own role — ask another admin.
 *       (2) The last remaining admin cannot be demoted — promote someone else first.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Target user's MongoDB ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [viewer, editor, admin]
 *     responses:
 *       200:
 *         description: Updated user object
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/User' }
 *       400:
 *         description: Invalid role, self-demotion attempt, or last-admin removal attempt
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.put('/users/:id/role', protect, authorize('admin'), updateRole);

/**
 * @swagger
 * /api/admin/videos:
 *   get:
 *     summary: Get all videos across all users
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of all videos with uploader details
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Video' }
 *       403:
 *         description: Admin role required
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get('/videos', protect, authorize('admin'), getAllVideos);

/**
 * @swagger
 * /api/admin/videos/{id}:
 *   delete:
 *     summary: Delete any video regardless of ownership
 *     tags: [Admin]
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
 *         description: Video not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.delete('/videos/:id', protect, authorize('admin'), deleteVideo);

module.exports = router;