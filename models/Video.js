// models/Video.js
const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  filename: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  mimetype: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  videoUrl: {
    type: String,
    default: null
  },
  thumbnailUrl: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['processing', 'safe', 'flagged'],
    default: 'processing'
  },
  duration: {
    type: Number,
    default: 0
  },
  sensitivity: {
    score: { type: Number, default: 0 },
    details: { type: String, default: '' }
  },
  assignedTo: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  ]
}, { timestamps: true });

module.exports = mongoose.model('Video', videoSchema);