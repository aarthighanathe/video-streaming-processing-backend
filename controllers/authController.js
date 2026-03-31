// controllers/authController.js
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');  // built-in Node module, no install needed

// ─── Token helpers ─────────────────────────────────────────────────────────

// Short-lived access token — used to authenticate API requests.
// 15 minutes is the industry standard; short enough that a leaked token
// expires quickly, long enough not to annoy users.
const generateAccessToken = (user) =>
  jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

// Long-lived refresh token — used only to get a new access token.
// Stored as a hash in MongoDB so a DB breach doesn't leak usable tokens.
const generateRefreshToken = (user) =>
  jwt.sign(
    { id: user._id },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: '7d' }
  );

// We hash the refresh token before storing it — same principle as password hashing.
// If the DB is leaked, the attacker gets hashes, not working tokens.
const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

// Sends the refresh token as an httpOnly cookie so JS on the page
// can never read it — mitigates XSS token theft.
const setRefreshCookie = (res, token) => {
  res.cookie('refreshToken', token, {
    httpOnly: true,                                    // not accessible via JS
    secure: process.env.NODE_ENV === 'production',  // HTTPS only in prod
    sameSite: 'strict',                               // no cross-site sends
    maxAge: 7 * 24 * 60 * 60 * 1000                // 7 days in ms
  });
};

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// ─── Register ──────────────────────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(400).json({ message: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase(),
      password: hashedPassword,
      role: 'viewer'
    });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Store the hash of the refresh token — never the raw value
    user.refreshTokenHash = hashToken(refreshToken);
    await user.save();

    setRefreshCookie(res, refreshToken);

    res.status(201).json({
      accessToken,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── Login ─────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(400).json({ message: 'Invalid email or password' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid email or password' });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Rotate: replace any previous refresh token hash with the new one
    user.refreshTokenHash = hashToken(refreshToken);
    await user.save();

    setRefreshCookie(res, refreshToken);

    res.json({
      accessToken,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── Refresh ───────────────────────────────────────────────────────────────
// Called by the frontend when the access token expires (401 response).
// Reads the refresh token from the httpOnly cookie, verifies it,
// checks the hash matches what's in the DB, then issues a new pair.
exports.refresh = async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;

    if (!token) {
      return res.status(401).json({ message: 'No refresh token' });
    }

    // Verify the JWT signature and expiry first
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
    } catch {
      return res.status(401).json({ message: 'Refresh token invalid or expired' });
    }

    // Then check the hash matches what we stored — this is what makes
    // logout actually work: clearning refreshTokenHash invalidates the token
    // even if the JWT itself hasn't expired yet
    const user = await User.findById(decoded.id);
    if (!user || user.refreshTokenHash !== hashToken(token)) {
      return res.status(401).json({ message: 'Refresh token has been revoked' });
    }

    // Token rotation — issue a fresh pair and update the stored hash.
    // This means each refresh token can only be used once, which limits
    // the damage window if a refresh token is ever intercepted.
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    user.refreshTokenHash = hashToken(newRefreshToken);
    await user.save();

    setRefreshCookie(res, newRefreshToken);

    res.json({
      accessToken: newAccessToken,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── Logout ────────────────────────────────────────────────────────────────
// Clears the refresh token hash in the DB (invalidates it server-side)
// and clears the httpOnly cookie. The access token will naturally expire
// in 15 minutes — this is acceptable and standard practice.
exports.logout = async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;

    if (token) {
      // Best-effort DB clear — if the user is already logged out or the
      // token doesn't match anyone, we still clear the cookie and return 200
      const decoded = jwt.decode(token); // decode without verify — just need the id
      if (decoded?.id) {
        await User.findByIdAndUpdate(decoded.id, { refreshTokenHash: null });
      }
    }

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── Get current user ──────────────────────────────────────────────────────
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -refreshTokenHash');
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};