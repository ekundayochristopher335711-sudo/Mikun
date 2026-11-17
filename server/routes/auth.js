import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db.js';
import { clearSession, createSession, HttpError, rateLimit, requireAuth, requireCsrf, validate } from '../http.js';

export const authRouter = Router();

const registerSchema = z.strictObject({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(30).default(''),
  password: z.string().min(12).max(128),
});
const loginSchema = z.strictObject({ email: z.email().max(254), password: z.string().min(1).max(128) });
const profileSchema = z.strictObject({ name: z.string().trim().min(2).max(80).optional(), phone: z.string().trim().max(30).optional() });

authRouter.post('/auth/register', rateLimit('register', 8, 60 * 60 * 1000), async (req, res) => {
  const input = validate(registerSchema, req.body);
  if (db.prepare('SELECT id FROM users WHERE email=?').get(input.email)) throw new HttpError(409, 'EMAIL_IN_USE', 'An account already uses this email address.');
  const now = new Date().toISOString();
  const id = randomUUID();
  const hash = await bcrypt.hash(input.password, 12);
  db.prepare('INSERT INTO users (id,name,email,phone,password_hash,role,active,created_at,updated_at) VALUES (?,?,?,?,?,\'customer\',1,?,?)')
    .run(id, input.name, input.email, input.phone, hash, now, now);
  const csrfToken = createSession(res, id);
  res.status(201).json({ user: { id, name: input.name, email: input.email, phone: input.phone, role: 'customer' }, csrfToken });
});

authRouter.post('/auth/login', rateLimit('login', 20, 15 * 60 * 1000), async (req, res) => {
  const input = validate(loginSchema, req.body);
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(input.email.toLowerCase());
  if (!user || !user.active || !(await bcrypt.compare(input.password, user.password_hash))) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }
  const csrfToken = createSession(res, user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role }, csrfToken });
});

authRouter.get('/auth/session', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ user: req.user, csrfToken: req.session?.csrfToken || null });
});

authRouter.post('/auth/logout', requireAuth, requireCsrf, (req, res) => {
  clearSession(req, res);
  res.json({ ok: true });
});

authRouter.get('/account/profile', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ user: req.user });
});

authRouter.patch('/account/profile', requireAuth, requireCsrf, (req, res) => {
  const input = validate(profileSchema, req.body);
  if (!Object.keys(input).length) throw new HttpError(400, 'NO_CHANGES', 'No profile changes were supplied.');
  const current = db.prepare('SELECT name,phone FROM users WHERE id=?').get(req.user.id);
  db.prepare('UPDATE users SET name=?,phone=?,updated_at=? WHERE id=?').run(input.name ?? current.name, input.phone ?? current.phone, new Date().toISOString(), req.user.id);
  const user = db.prepare('SELECT id,name,email,phone,role FROM users WHERE id=?').get(req.user.id);
  res.json({ user });
});

authRouter.get('/account/orders', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const orders = db.prepare(`SELECT id,fulfilment,subtotal,delivery_fee,discount,total,status,payment_method,payment_status,created_at,updated_at
    FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100`).all(req.user.id);
  res.json({ orders });
});

authRouter.get('/account/reservations', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const reservations = db.prepare(`SELECT r.id,r.reservation_date,r.reservation_time,r.party_size,r.requests,r.status,r.created_at,t.label AS table_label
    FROM reservations r JOIN restaurant_tables t ON t.id=r.table_id WHERE r.user_id=? ORDER BY r.reservation_date DESC,r.reservation_time DESC LIMIT 100`).all(req.user.id);
  res.json({ reservations });
});
