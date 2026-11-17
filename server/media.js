import { Router, raw, static as serveStatic } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit } from './db.js';
import { HttpError, rateLimit, requireCsrf, requireRole } from './http.js';

const here = dirname(fileURLToPath(import.meta.url));
const mediaDirectory = process.env.MEDIA_DIR || join(here, 'data', 'media');
mkdirSync(mediaDirectory, { recursive: true });

export const mediaRouter = Router();
mediaRouter.use('/media', serveStatic(mediaDirectory, {
  immutable: true, maxAge: '1y', fallthrough: false,
  setHeaders(res) { res.setHeader('X-Content-Type-Options', 'nosniff'); },
}));

function imageType(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png', ext: 'png' };
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

mediaRouter.post('/admin/media', requireRole('owner', 'administrator', 'manager'), requireCsrf,
  rateLimit('media', 60, 60 * 60 * 1000),
  raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }),
  (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 20) throw new HttpError(400, 'IMAGE_REQUIRED', 'Upload a JPEG, PNG, or WebP image.');
    const type = imageType(req.body);
    if (!type || req.get('Content-Type')?.split(';')[0] !== type.mime) throw new HttpError(400, 'IMAGE_INVALID', 'Image format and content type must match.');
    const id = randomUUID();
    const filename = `${id}.${type.ext}`;
    writeFileSync(join(mediaDirectory, filename), req.body, { flag: 'wx' });
    const url = `/api/media/${filename}`;
    audit(req.user.id, 'upload', 'media', id, null, { url, bytes: req.body.length, mime: type.mime });
    res.status(201).json({ url, bytes: req.body.length, mime: type.mime });
  });
