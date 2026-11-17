import express, { static as serveStatic } from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { authRouter } from './routes/auth.js';
import { publicRouter } from './routes/public.js';
import { adminMenuRouter } from './routes/admin-menu.js';
import { adminOperationsRouter } from './routes/admin-operations.js';
import { adminBusinessRouter } from './routes/admin-business.js';
import { mediaRouter } from './media.js';
import { errorHandler, guardOrigin, loadSession } from './http.js';

export const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});
app.use('/api', guardOrigin, loadSession, mediaRouter);
app.use('/api', express.json({ limit: '100kb', type: 'application/json' }));
app.use('/api', authRouter, publicRouter);
app.use('/api/admin', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api/admin', adminMenuRouter, adminOperationsRouter, adminBusinessRouter);
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } }));
const distDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (existsSync(join(distDirectory, 'index.html'))) {
  app.use(serveStatic(distDirectory));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || !req.accepts('html')) return next();
    res.sendFile(join(distDirectory, 'index.html'));
  });
}
app.use(errorHandler);

const launchedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (launchedDirectly) {
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');
  app.listen(port, () => console.log(`Mikun API listening on http://localhost:${port}/api`));
}
