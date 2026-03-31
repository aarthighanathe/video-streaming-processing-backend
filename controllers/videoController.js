// controllers/videoController.js
const Video = require('../models/Video');
const { cloudinary } = require('../config/cloudinary');

// ─── Direct-upload signature ───────────────────────────────────────────────
exports.getUploadSignature = (req, res) => {
  try {
    const timestamp = Math.round(Date.now() / 1000);
    const folder = 'videoapp/videos';
    const eager = 'sp_hd/m3u8|so_5/fl_attachment';

    const paramsToSign = { timestamp, folder, eager };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET
    );

    res.json({
      signature,
      timestamp,
      folder,
      eager,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY
    });
  } catch (error) {
    res.status(500).json({ message: 'Could not generate upload signature', error: error.message });
  }
};

// ─── Save video metadata after direct upload ───────────────────────────────
exports.saveVideo = async (req, res) => {
  try {
    const { title, publicId, videoUrl, thumbnailUrl, originalName, mimetype, size } = req.body;

    if (!publicId || !videoUrl) {
      return res.status(400).json({ message: 'publicId and videoUrl are required' });
    }

    const video = await Video.create({
      title: title || originalName || publicId,
      filename: publicId,
      originalName: originalName || publicId,
      mimetype: mimetype || 'video/mp4',
      size: size || 0,
      uploadedBy: req.user.id,
      status: 'processing',
      videoUrl,
      thumbnailUrl: thumbnailUrl || null
    });

    // Enqueue the processing job instead of calling processVideo directly.
    // The job is persisted in Redis — if the server restarts before the worker
    // picks it up, the job survives and will be processed when the server
    // comes back online.
    const { videoQueue } = require('../services/videoQueue');
    await videoQueue.add('process', {
      videoId: String(video._id),
      publicId,
      uploadedBy: String(req.user.id)
    });

    res.status(201).json({ message: 'Upload saved, processing queued', video });
  } catch (error) {
    res.status(500).json({ message: 'Failed to save video', error: error.message });
  }
};

// ─── Get videos — role-filtered ────────────────────────────────────────────
exports.getVideos = async (req, res) => {
  try {
    const { status } = req.query;
    let filter = {};

    if (req.user.role === 'admin') {
      filter = {};
    } else if (req.user.role === 'editor') {
      filter = { $or: [{ uploadedBy: req.user.id }, { assignedTo: req.user.id }] };
    } else {
      filter = { assignedTo: req.user.id };
    }

    if (status) {
      if (filter.$or) {
        filter = { $and: [{ $or: filter.$or }, { status }] };
      } else {
        filter.status = status;
      }
    }

    const videos = await Video.find(filter)
      .populate('uploadedBy', 'name email')
      .sort({ createdAt: -1 });

    res.json(videos);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── Get single video ──────────────────────────────────────────────────────
exports.getVideo = async (req, res) => {
  try {
    let video;
    if (req.user.role === 'viewer') {
      video = await Video.findOne({ _id: req.params.id, assignedTo: req.user.id })
        .populate('uploadedBy', 'name email');
    } else if (req.user.role === 'admin') {
      video = await Video.findById(req.params.id)
        .populate('uploadedBy', 'name email');
    } else {
     video = await Video.findOne({
  _id: req.params.id,
  $or: [{ uploadedBy: req.user.id }, { assignedTo: req.user.id }]
})
    }

    if (!video) return res.status(404).json({ message: 'Video not found' });
    res.json(video);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── Delete video ──────────────────────────────────────────────────────────
exports.deleteVideo = async (req, res) => {
  try {
    const video = await Video.findOne({ _id: req.params.id, uploadedBy: req.user.id });

    if (!video) return res.status(404).json({ message: 'Video not found' });

    try {
      await cloudinary.uploader.destroy(video.filename, { resource_type: 'video' });
    } catch (cloudinaryErr) {
      console.error('Cloudinary delete error:', cloudinaryErr.message);
    }

    await video.deleteOne();
    res.json({ message: 'Video deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.streamVideo = async (req, res) => {
  try {
    let video
    if (req.user.role === 'viewer') {
      video = await Video.findOne({ _id: req.params.id, assignedTo: req.user.id })
    } else if (req.user.role === 'admin') {
      video = await Video.findById(req.params.id)
    } else {
      video = await Video.findOne({
        _id: req.params.id,
        $or: [{ uploadedBy: req.user.id }, { assignedTo: req.user.id }]
      })
    }

    if (!video) return res.status(404).json({ message: 'Video not found' })
    if (!video.filename) return res.status(404).json({ message: 'Video file not found' })

    if (video.status === 'processing') {
      return res.status(202).json({ message: 'Video is still processing, please try again shortly' })
    }

    const expiresAt = Math.floor(Date.now() / 1000) + 3600 // 1 hour

    // Generate a signed, expiring Cloudinary URL
    const videoUrl = cloudinary.url(video.filename, {
      resource_type: 'video',
      sign_url: true,
      expires_at: expiresAt,
      secure: true
    })

    // ── Range request proxy ──────────────────────────────────────────────
    // When the client sends a Range header (e.g. video seek, or tools like
    // curl testing range support), we proxy the request to Cloudinary and
    // pipe the partial response back. This satisfies the assignment's
    // "HTTP range request support" requirement at the server level while
    // still letting direct browser playback hit Cloudinary's CDN natively.
    const rangeHeader = req.headers['range']
    if (rangeHeader) {
      try {
        // Use node-fetch or the built-in fetch (Node 18+) to proxy the range request
        const upstream = await fetch(videoUrl, {
          headers: {
            Range: rangeHeader,
            // Forward user-agent so Cloudinary doesn't reject the proxy
            'User-Agent': req.headers['user-agent'] || 'VideoApp/1.0'
          }
        })

        if (!upstream.ok && upstream.status !== 206) {
          return res.status(upstream.status).json({ message: 'Upstream range request failed' })
        }

        // Mirror the partial content headers back to the client
        const contentRange = upstream.headers.get('content-range')
        const contentLength = upstream.headers.get('content-length')
        const contentType = upstream.headers.get('content-type') || 'video/mp4'

        res.status(206)
        res.set('Content-Type', contentType)
        res.set('Accept-Ranges', 'bytes')
        if (contentRange) res.set('Content-Range', contentRange)
        if (contentLength) res.set('Content-Length', contentLength)
        res.set('Cache-Control', 'no-store') // don't cache partial responses

        // Pipe the upstream body to the response
        // Node 18+ ReadableStream → Node stream via pipeline
        const { Readable } = require('stream')
        const nodeStream = Readable.fromWeb(upstream.body)
        nodeStream.pipe(res)
        return
      } catch (proxyErr) {
        console.error('[streamVideo] Range proxy error:', proxyErr.message)
        // Fall through to JSON response if proxy fails
      }
    }

    // ── Normal (non-range) response — return signed URL for direct playback ──
    res.json({
      streamUrl: videoUrl,
      videoUrl,
      expiresAt,
      title: video.title,
      thumbnailUrl: video.thumbnailUrl || null,
      duration: video.duration || null
    })

  } catch (error) {
    res.status(500).json({ message: 'Streaming failed', error: error.message })
  }
}

// ─── Assign video ──────────────────────────────────────────────────────────
exports.assignVideo = async (req, res) => {
  try {
    const { userIds } = req.body;
    let video;

    if (req.user.role === 'admin') {
      video = await Video.findById(req.params.id);
    } else {
      video = await Video.findOne({ _id: req.params.id, uploadedBy: req.user.id });
    }

    if (!video) return res.status(404).json({ message: 'Video not found' });

    const User = require('../models/User');
    const users = await User.find({ _id: { $in: userIds }, role: { $in: ['viewer', 'editor'] } });

    if (users.length !== userIds.length) {
      return res.status(400).json({ message: 'One or more invalid user IDs' });
    }

    video.assignedTo = userIds;
    await video.save();

    res.json({ message: 'Video assigned successfully', assignedTo: video.assignedTo });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── Get assignable users ──────────────────────────────────────────────────
exports.getViewers = async (req, res) => {
  try {
    const User = require('../models/User');
    const users = await User.find({ role: { $in: ['viewer', 'editor'] } })
      .select('_id name email role');
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


exports.updateVideo = async (req, res) => {
  try {
    const { title } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Title is required' });
    }

    let video;
    if (req.user.role === 'admin') {
      video = await Video.findById(req.params.id);
    } else {
      // Editors can only rename their own videos
      video = await Video.findOne({ _id: req.params.id, uploadedBy: req.user.id });
    }

    if (!video) return res.status(404).json({ message: 'Video not found' });

    video.title = title.trim();
    await video.save();

    res.json({ message: 'Video updated', video });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};