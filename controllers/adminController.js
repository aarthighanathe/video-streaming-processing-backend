// controllers/adminController.js
const User = require('../models/User');
const Video = require('../models/Video');
const { cloudinary } = require('../config/cloudinary');

// ─── Get all users ─────────────────────────────────────────────────────────
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find()
      .select('-password -refreshTokenHash')
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── Update user role ──────────────────────────────────────────────────────
exports.updateRole = async (req, res) => {
  try {
    const { role } = req.body;

    if (!['viewer', 'editor', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be viewer, editor, or admin' });
    }

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // ── Guard 1: prevent self-demotion ────────────────────────────────────
    // An admin demoting themselves could leave the system without an active
    // admin if they are the only one. We block it entirely — a second admin
    // must make this change instead.
    if (String(targetUser._id) === String(req.user.id) && role !== 'admin') {
      return res.status(400).json({
        message: 'You cannot change your own role. Ask another admin to do this.'
      });
    }

    // ── Guard 2: prevent last-admin removal ───────────────────────────────
    // If the target is currently an admin and the new role is not admin,
    // count how many admins exist. If this is the only one, block the change.
    if (targetUser.role === 'admin' && role !== 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        return res.status(400).json({
          message: 'Cannot demote the last admin. Promote another user to admin first.'
        });
      }
    }

    targetUser.role = role;
    await targetUser.save();

    const updated = targetUser.toObject();
    delete updated.password;
    delete updated.refreshTokenHash;

    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── Get all videos (admin sees everyone's) ────────────────────────────────
exports.getAllVideos = async (req, res) => {
  try {
    const videos = await Video.find()
      .populate('uploadedBy', 'name email')
      .sort({ createdAt: -1 });
    res.json(videos);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── Delete any video ──────────────────────────────────────────────────────
exports.deleteVideo = async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }

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