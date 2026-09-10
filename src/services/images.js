const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const { nanoid } = require('nanoid');

const IMAGES_DIR = process.env.IMAGES_DIR || '/data/images';

async function ensureDir() {
  await fs.mkdir(IMAGES_DIR, { recursive: true });
}

/** Accepts a base64 (no data: prefix) or raw Buffer, returns { filename, buffer } of the compressed JPEG. */
async function compressAndSave(input) {
  await ensureDir();
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, 'base64');
  const compressed = await sharp(buffer)
    .rotate() // respect EXIF orientation from phone cameras
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();

  const filename = `${nanoid(16)}.jpg`;
  await fs.writeFile(path.join(IMAGES_DIR, filename), compressed);
  return { filename, buffer: compressed };
}

async function readImage(filename) {
  if (!filename || filename.includes('..') || filename.includes('/')) return null;
  try {
    return await fs.readFile(path.join(IMAGES_DIR, filename));
  } catch {
    return null;
  }
}

async function deleteImage(filename) {
  if (!filename || filename.includes('..') || filename.includes('/')) return;
  await fs.unlink(path.join(IMAGES_DIR, filename)).catch(() => {});
}

module.exports = { compressAndSave, readImage, deleteImage, IMAGES_DIR };
