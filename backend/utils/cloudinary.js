const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');

const getConfig = () => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
  }

  return { cloudName, apiKey, apiSecret };
};

const signParams = (params, apiSecret) => {
  const payload = Object.keys(params)
    .filter(key => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');

  return crypto.createHash('sha1').update(`${payload}${apiSecret}`).digest('hex');
};

const uploadFile = async (filePath, options = {}) => {
  const { cloudName, apiKey, apiSecret } = getConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = options.folder || process.env.CLOUDINARY_FOLDER || 'studysphere';
  const resourceType = options.resourceType || 'image';
  const params = {
    timestamp,
    folder,
    public_id: options.publicId,
  };

  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('api_key', apiKey);
  form.append('timestamp', timestamp);
  form.append('folder', folder);
  if (options.publicId) form.append('public_id', options.publicId);
  form.append('signature', signParams(params, apiSecret));

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
    timeout: options.timeout || 60000
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Cloudinary upload failed');
  }

  return {
    url: data.secure_url,
    publicId: data.public_id,
    resourceType,
    width: data.width,
    height: data.height,
    format: data.format,
    bytes: data.bytes
  };
};

const uploadImage = (filePath, options = {}) => uploadFile(filePath, { ...options, resourceType: options.resourceType || 'image' });

const deleteImage = async (publicId, options = {}) => {
  if (!publicId) return { deleted: false, reason: 'Missing Cloudinary public id' };

  const { cloudName, apiKey, apiSecret } = getConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const resourceType = options.resourceType || 'image';
  const params = { public_id: publicId, timestamp };

  const form = new FormData();
  form.append('public_id', publicId);
  form.append('api_key', apiKey);
  form.append('timestamp', timestamp);
  form.append('signature', signParams(params, apiSecret));

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
    timeout: options.timeout || 60000
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Cloudinary delete failed');
  }

  return {
    deleted: data.result === 'ok' || data.result === 'not found',
    result: data.result
  };
};

const isRemoteImage = (value) => /^https?:\/\//i.test(String(value || ''));

const downloadImage = async (imageUrl, prefix = 'cloudinary-image') => {
  const response = await fetch(imageUrl, { timeout: 60000 });
  if (!response.ok) {
    throw new Error(`Could not fetch image from Cloudinary (${response.status})`);
  }

  const buffer = await response.buffer();
  const ext = path.extname(new URL(imageUrl).pathname) || '.jpg';
  const tempPath = path.join(os.tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  fs.writeFileSync(tempPath, buffer);
  return tempPath;
};

module.exports = {
  uploadFile,
  uploadImage,
  deleteImage,
  downloadImage,
  isRemoteImage
};
