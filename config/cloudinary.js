// config/cloudinary.js
const cloudinary = require('cloudinary').v2
const { CloudinaryStorage } = require('multer-storage-cloudinary')
const multer = require('multer')

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
})

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    resource_type: 'video',
    folder: 'videoapp/videos',
    allowed_formats: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
    eager: [
      // HLS adaptive stream only — thumbnail is generated on-the-fly via URL
      // The jpg eager was removed because eager_async:true means it's never
      // ready when saveVideo runs, so the stored thumbnailUrl was always broken.
      { streaming_profile: 'hd', format: 'm3u8' },
    ],
    eager_async: true
  }
})

const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } })

module.exports = { cloudinary, upload }