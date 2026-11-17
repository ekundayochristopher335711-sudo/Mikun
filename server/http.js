import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';

export class HttpError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function validate(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Please check the submitted details.', result.error.flatten());
  }
  return result.data;
}

export function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return [part, ''];
    try { return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]; }
    catch { return [part.slice(0, index), '']; }
  }));
}

const sessionCookie = 'mikun_session';
const sessionAge = 7 * 24 * 60 * 60 * 1000;

export function loadSession(req, _res, next) {
  req.user = null;
  req.session = null;
  const token = cookies(req)[sessionCookie];
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const row = db.prepare(`SELECT s.token_hash,s.csrf_token,s.expires_at,u.id,u.name,u.email,u.phone,u.role,u.active
      FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash(token), new Date().toISOString());
    if (row && row.active) {
      req.session = { tokenHash: row.token_hash, csrfToken: row.csrf_token, expiresAt: row.expires_at };
      req.user = { id: row.id, name: row.name, email: row.email, phone: row.phone, role: row.role };
    }
  }
  next();
}

export function createSession(res, userId) {
  const token = randomBytes(32).toString('hex');
  const csrfToken = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + sessionAge).toISOString();
  db.prepare('INSERT INTO sessions (token_hash,user_id,csrf_token,created_at,expires_at) VALUES (?,?,?,?,?)')
    .run(tokenHash(token), userId, csrfToken, new Date().toISOString(), expiresAt);
  res.cookie(sessionCookie, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api',
    maxAge: sessionAge,
  });
  return csrfToken;
}

export function clearSession(req, res) {
  if (req.session) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.session.tokenHash);
  res.clearCookie(sessionCookie, { path: '/api', sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
}

export function requireAuth(req, _res, next) {
  if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  next();
}

export function requireRole(...allowed) {
  return (req, _res, next) => {
    if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    if (!allowed.includes(req.user.role)) throw new HttpError(403, 'FORBIDDEN', 'You do not have permission for this action.');
    next();
  };
}

export function requireCsrf(req, _res, next) {
  if (!req.session) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
  const provided = req.get('X-CSRF-Token') || '';
  const expected = req.session.csrfToken;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) {
    throw new HttpError(403, 'CSRF_INVALID', 'Refresh this page and try again.');
  }
  next();
}

export function guardOrigin(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('Sec-Fetch-Site') === 'cross-site') throw new HttpError(403, 'CROSS_SITE_REQUEST', 'Cross-site requests are not allowed.');
  const origin = req.get('Origin');
  if (origin) {
    const expected = process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
    if (origin !== expected) throw new HttpError(403, 'ORIGIN_INVALID', 'Request origin is not allowed.');
  }
  next();
}

const attempts = new Map();
export function rateLimit(bucket, limit, windowMs) {
  return (req, _res, next) => {
    const key = `${bucket}:${req.ip}`;
    const now = Date.now();
    const state = attempts.get(key);
    if (!state || now > state.resetAt) attempts.set(key, { count: 1, resetAt: now + windowMs });
    else if (state.count >= limit) throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
    else state.count += 1;
    if (attempts.size > 5000) {
      for (const [entry, value] of attempts) if (now > value.resetAt) attempts.delete(entry);
    }
    next();
  };
}

export function errorHandler(error, _req, res, _next) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
  }
  if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The uploaded content is too large.' } });
  if (error?.status === 404) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } });
  if (error?.code?.startsWith?.('SQLITE_CONSTRAINT')) return res.status(409).json({ error: { code: 'CONFLICT', message: 'This action conflicts with existing data.' } });
  console.error(error);
  return res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'The server could not complete this request.' } });
}
