const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { register, login, refresh, logout, getMe } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { message: 'Too many refresh attempts, please log in again' },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Registration, login, token refresh and logout
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name:     { type: string, example: Jane Smith }
 *               email:    { type: string, example: jane@example.com }
 *               password: { type: string, minLength: 6, example: secret123 }
 *     responses:
 *       201:
 *         description: Registered successfully. Refresh token set as httpOnly cookie.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthResponse' }
 *       400:
 *         description: Validation error or email already registered
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/register', authLimiter, register);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login with email and password
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:    { type: string, example: jane@example.com }
 *               password: { type: string, example: secret123 }
 *     responses:
 *       200:
 *         description: Login successful. Refresh token set as httpOnly cookie.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthResponse' }
 *       400:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/login', authLimiter, login);

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Get a new access token using the refresh token cookie
 *     tags: [Auth]
 *     security: []
 *     description: >
 *       The refresh token is read automatically from the httpOnly cookie set
 *       during login/register. No request body is needed. Call this endpoint
 *       whenever the API returns 401 to silently renew the session.
 *     responses:
 *       200:
 *         description: New access token issued. Refresh token rotated (new cookie set).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthResponse' }
 *       401:
 *         description: Refresh token missing, expired, or revoked
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/refresh', refreshLimiter, refresh);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout and invalidate the refresh token
 *     tags: [Auth]
 *     description: >
 *       Clears the refresh token hash from the database and removes the cookie.
 *       The access token expires naturally within 15 minutes.
 *     responses:
 *       200:
 *         description: Logged out successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: Logged out successfully }
 *       401:
 *         description: No valid access token provided
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/logout', protect, logout);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get the currently authenticated user
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Current user profile
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/User' }
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get('/me', protect, getMe);

module.exports = router;