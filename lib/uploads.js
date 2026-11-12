// Stores owner-uploaded photos: Vercel Blob when configured, otherwise ./data/uploads.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const LOCAL_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'uploads');

async function saveImage(buffer, contentType) {
  const ext = TYPES[contentType];
  if (!ext) throw Object.assign(new Error('Please upload a JPG, PNG, WebP or GIF image'), { code: 400 });
  const name = `${crypto.randomBytes(10).toString('hex')}.${ext}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = require('@vercel/blob');
    const blob = await put(`items/${name}`, buffer, { access: 'public', contentType });
    return blob.url;
  }
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOCAL_DIR, name), buffer);
  return `/uploads/${name}`;
}

module.exports = { saveImage, LOCAL_DIR };
