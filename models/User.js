// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['viewer', 'editor', 'admin'],
    default: 'viewer'
  },
  // ─── Refresh token support ─────────────────────────────────────────────
  // We store a hashed version of the refresh token — never the raw value.
  // On logout or token rotation, this field is cleared, which immediately
  // invalidates any refresh token in the wild even if it hasn't expired yet.
  refreshTokenHash: {
    type: String,
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);