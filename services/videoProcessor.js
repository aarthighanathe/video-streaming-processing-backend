// services/videoProcessor.js
const Video = require('../models/Video');
const { cloudinary } = require('../config/cloudinary');

let io = null;
const setIo = (socketIo) => { io = socketIo; };

// ─── Cloudinary metadata ───────────────────────────────────────────────────
const getVideoMetadata = async (publicId) => {
  const result = await cloudinary.api.resource(publicId, {
    resource_type: 'video',
    media_metadata: true
  });
  return {
    duration: parseFloat(result.duration) || 0,
    width: parseInt(result.width) || 0,
    height: parseInt(result.height) || 0,
    bitrate: parseInt(result.bit_rate) || 0,
    size: parseInt(result.bytes) || 0,
    fps: parseFloat(result.frame_rate) || 0,
    hasAudio: result.audio != null,
    format: (result.format || publicId.split('.').pop() || 'mp4').toLowerCase()
  };
};

// ─── Sensitivity analysis (simulated — see inline docs) ───────────────────
const analyzeSensitivity = ({ bitrate, duration, fps, hasAudio, size, width, height, format }) => {
  let score = 0;
  const signals = [];

  if (!hasAudio && duration > 0 && duration < 30) {
    score += 0.30;
    signals.push('short silent clip');
  }

  const pixels = (width || 1) * (height || 1);
  const bitsPerPixelPerSecond = bitrate / pixels;
  if (bitsPerPixelPerSecond > 3) {
    score += 0.25;
    signals.push('high bitrate-to-resolution ratio');
  }

  const bytesPerSecond = duration > 0 ? size / duration : 0;
  if (bytesPerSecond > 4 * 1024 * 1024) {
    score += 0.20;
    signals.push('high data rate');
  }

  if (fps > 60) {
    score += 0.15;
    signals.push('non-standard frame rate');
  }

  if (!['mp4', 'webm'].includes(format)) {
    score += 0.10;
    signals.push(`non-standard container (${format})`);
  }

  score = Math.min(parseFloat(score.toFixed(2)), 1);
  const isFlagged = score >= 0.40;

  const details = isFlagged
    ? `Flagged (demo heuristics) — score: ${score}. Signals: ${signals.join('; ') || 'combined indicators'}. NOTE: simulated metadata analysis, not frame-level content moderation.`
    : `Safe (demo heuristics) — score: ${score}. No significant structural signals detected. NOTE: simulated metadata analysis, not frame-level content moderation.`;

  return { score, isFlagged, details };
};

// ─── Emit helper ──────────────────────────────────────────────────────────
const emit = (userId, event, payload) => {
  if (!io) return;
  io.to(String(userId)).emit(event, payload);
};

// ─── Core processing function ─────────────────────────────────────────────
// This is called by the BullMQ worker — NOT directly from the controller
// anymore. BullMQ handles retries, so if this throws, the job is
// automatically re-queued up to 3 times with exponential backoff.
const processVideo = async (videoId, publicId, uploadedBy) => {
  try {
    await Video.findByIdAndUpdate(videoId, { status: 'processing' });
    emit(uploadedBy, 'videoProgress', {
      videoId, progress: 15, message: 'Upload confirmed, fetching metadata...'
    });

    let meta;
    try {
      meta = await getVideoMetadata(publicId);
    } catch (err) {
      console.error('Cloudinary metadata error:', err.message);
      meta = { duration: 0, width: 0, height: 0, bitrate: 0, size: 0, fps: 0, hasAudio: true, format: 'mp4' };
    }

    emit(uploadedBy, 'videoProgress', {
      videoId, progress: 50, message: 'Metadata received, running analysis...'
    });

    await Video.findByIdAndUpdate(videoId, {
      duration: parseFloat((meta.duration || 0).toFixed(2))
    });

    emit(uploadedBy, 'videoProgress', {
      videoId, progress: 75, message: 'Analysing content sensitivity...'
    });

    const { score, isFlagged, details } = analyzeSensitivity(meta);

    emit(uploadedBy, 'videoProgress', {
      videoId, progress: 90, message: 'Writing classification...'
    });

    await Video.findByIdAndUpdate(videoId, {
      status: isFlagged ? 'flagged' : 'safe',
      sensitivity: { score, details }
    });

    emit(uploadedBy, 'videoProgress', {
      videoId,
      progress: 100,
      message: isFlagged
        ? 'Video flagged — sensitive content detected'
        : 'Video cleared — safe to stream',
      status: isFlagged ? 'flagged' : 'safe',
      sensitivity: { score, details }
    });

  } catch (error) {
    // Re-throw so BullMQ knows the job failed and should retry
    console.error(`processVideo error for ${videoId}:`, error.message);
    await Video.findByIdAndUpdate(videoId, { status: 'processing' }); // keep as processing during retries
    throw error; // BullMQ catches this and schedules the retry
  }
};

module.exports = { processVideo, setIo };