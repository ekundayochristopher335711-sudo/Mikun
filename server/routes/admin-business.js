import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { audit, db, readKeyValues, writeKeyValues } from '../db.js';
import { HttpError, requireCsrf, requireRole, validate } from '../http.js';

export const adminBusinessRouter = Router();
const managers = requireRole('owner', 'administrator', 'manager');
const owners = requireRole('owner');
const imageUrl = z.union([z.string().url().refine((value) => value.startsWith('https://')), z.string().regex(/^\/(?!\/)[a-zA-Z0-9_./-]+$/), z.literal('')]);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const settingsSchema = z.strictObject({
  businessName: z.string().trim().min(2).max(100),
  tagline: z.string().trim().max(150),
  currency: z.string().trim().min(1).max(6),
  phone: z.string().trim().max(30),
  whatsapp: z.string().trim().max(30),
  email: z.union([z.email().max(254), z.literal('')]),
  address: z.string().trim().max(250),
  hours: z.string().trim().max(300),
  instagram: z.string().trim().max(200),
  acceptingOrders: z.boolean(),
  deliveryEnabled: z.boolean(),
  deliveryFee: z.number().int().min(0).max(100000),
  reservationsEnabled: z.boolean(),
  reservationSlots: z.array(time).max(30),
});
const contentSchema = z.strictObject({
  heroHeadline: z.string().trim().max(160),
  heroDescription: z.string().trim().max(600),
  heroImageUrl: imageUrl,
  aboutHeadline: z.string().trim().max(160),
  aboutText: z.string().trim().max(1200),
  aboutImageUrl: imageUrl,
  galleryImages: z.array(imageUrl).max(30),
  announcement: z.string().trim().max(200),
});

adminBusinessRouter.get('/settings', managers, (_req, res) => {
  res.json({ settings: readKeyValues('settings'), content: readKeyValues('content') });
});

adminBusinessRouter.patch('/settings', managers, requireCsrf, (req, res) => {
  const input = validate(settingsSchema.partial(), req.body);
  if (!Object.keys(input).length) throw new HttpError(400, 'NO_CHANGES', 'No settings changes were supplied.');
  if (input.reservationSlots && new Set(input.reservationSlots).size !== input.reservationSlots.length) throw new HttpError(400, 'DUPLICATE_SLOT', 'Reservation times must be unique.');
  if (input.reservationsEnabled === true) {
    const tables = db.prepare('SELECT COUNT(*) AS count FROM restaurant_tables WHERE active=1').get().count;
    if (!tables) throw new HttpError(409, 'TABLES_REQUIRED', 'Add an active table before opening reservations.');
  }
  const before = readKeyValues('settings');
  writeKeyValues('settings', input);
  audit(req.user.id, 'update', 'settings', 'restaurant', before, readKeyValues('settings'));
  res.json({ settings: readKeyValues('settings') });
});

adminBusinessRouter.patch('/content', managers, requireCsrf, (req, res) => {
  const input = validate(contentSchema.partial(), req.body);
  if (!Object.keys(input).length) throw new HttpError(400, 'NO_CHANGES', 'No content changes were supplied.');
  const before = readKeyValues('content');
  writeKeyValues('content', input);
  audit(req.user.id, 'update', 'content', 'website', before, readKeyValues('content'));
  res.json({ content: readKeyValues('content') });
});

const promotionSchema = z.strictObject({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/),
  kind: z.enum(['percent', 'fixed']),
  value: z.number().int().min(1).max(10000000),
  minimumSpend: z.number().int().min(0).max(10000000).default(0),
  usageLimit: z.number().int().min(1).max(100000).nullable().default(null),
  startsAt: z.iso.datetime().nullable().default(null),
  expiresAt: z.iso.datetime().nullable().default(null),
  active: z.boolean().default(true),
});

function validatePromotion(input) {
  if (input.kind === 'percent' && input.value > 100) throw new HttpError(400, 'PERCENT_INVALID', 'Percentage discounts cannot exceed 100%.');
  if (input.startsAt && input.expiresAt && input.startsAt >= input.expiresAt) throw new HttpError(400, 'DATES_INVALID', 'Expiry must follow the start date.');
}

function promotionView(row) {
  return row && { id: row.id, code: row.code, kind: row.kind, value: row.value, minimumSpend: row.minimum_spend, usageLimit: row.usage_limit, usedCount: row.used_count, startsAt: row.starts_at, expiresAt: row.expires_at, active: Boolean(row.active), createdAt: row.created_at };
}

adminBusinessRouter.get('/promotions', managers, (_req, res) => {
  res.json({ promotions: db.prepare('SELECT * FROM promotions ORDER BY created_at DESC').all().map(promotionView) });
});

adminBusinessRouter.post('/promotions', managers, requireCsrf, (req, res) => {
  const input = validate(promotionSchema, req.body);
  validatePromotion(input);
  const id = randomUUID();
  db.prepare('INSERT INTO promotions (id,code,kind,value,minimum_spend,usage_limit,starts_at,expires_at,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, input.code, input.kind, input.value, input.minimumSpend, input.usageLimit, input.startsAt, input.expiresAt, Number(input.active), new Date().toISOString());
  audit(req.user.id, 'create', 'promotion', id, null, input);
  res.status(201).json({ promotion: promotionView(db.prepare('SELECT * FROM promotions WHERE id=?').get(id)) });
});

adminBusinessRouter.patch('/promotions/:id', managers, requireCsrf, (req, res) => {
  const input = validate(promotionSchema.partial(), req.body);
  const row = db.prepare('SELECT * FROM promotions WHERE id=?').get(req.params.id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Promotion not found.');
  const before = promotionView(row);
  const after = { ...before, ...input };
  validatePromotion(after);
  db.prepare('UPDATE promotions SET code=?,kind=?,value=?,minimum_spend=?,usage_limit=?,starts_at=?,expires_at=?,active=? WHERE id=?')
    .run(after.code, after.kind, after.value, after.minimumSpend, after.usageLimit, after.startsAt, after.expiresAt, Number(after.active), row.id);
  audit(req.user.id, 'update', 'promotion', row.id, before, after);
  res.json({ promotion: promotionView(db.prepare('SELECT * FROM promotions WHERE id=?').get(row.id)) });
});

adminBusinessRouter.delete('/promotions/:id', managers, requireCsrf, (req, res) => {
  const before = promotionView(db.prepare('SELECT * FROM promotions WHERE id=?').get(req.params.id));
  if (!before) throw new HttpError(404, 'NOT_FOUND', 'Promotion not found.');
  if (db.prepare('SELECT 1 FROM orders WHERE promotion_id=? LIMIT 1').get(before.id)) {
    db.prepare('UPDATE promotions SET active=0 WHERE id=?').run(before.id);
    audit(req.user.id, 'deactivate', 'promotion', before.id, before, { ...before, active: false });
    return res.json({ ok: true, deactivated: true });
  }
  db.prepare('DELETE FROM promotions WHERE id=?').run(before.id);
  audit(req.user.id, 'delete', 'promotion', before.id, before, null);
  res.json({ ok: true });
});

const staffRole = z.enum(['administrator', 'manager', 'cashier', 'kitchen', 'delivery']);
const staffSchema = z.strictObject({ name: z.string().trim().min(2).max(80), email: z.email().max(254).transform((value) => value.toLowerCase()), phone: z.string().trim().max(30).default(''), password: z.string().min(12).max(128), role: staffRole });

adminBusinessRouter.get('/staff', owners, (_req, res) => {
  res.json({ staff: db.prepare("SELECT id,name,email,phone,role,active,created_at AS createdAt FROM users WHERE role<>'customer' ORDER BY created_at DESC").all().map((member) => ({ ...member, active: Boolean(member.active) })) });
});

adminBusinessRouter.post('/staff', owners, requireCsrf, async (req, res) => {
  const input = validate(staffSchema, req.body);
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(input.email)) throw new HttpError(409, 'EMAIL_IN_USE', 'An account already uses this email address.');
  const id = randomUUID(); const now = new Date().toISOString();
  const hash = await bcrypt.hash(input.password, 12);
  db.prepare('INSERT INTO users (id,name,email,phone,password_hash,role,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)').run(id, input.name, input.email, input.phone, hash, input.role, now, now);
  audit(req.user.id, 'create', 'staff', id, null, { name: input.name, email: input.email, role: input.role });
  res.status(201).json({ staff: { id, name: input.name, email: input.email, phone: input.phone, role: input.role, active: true } });
});

adminBusinessRouter.patch('/staff/:id', owners, requireCsrf, (req, res) => {
  const input = validate(z.strictObject({ role: staffRole.optional(), active: z.boolean().optional() }), req.body);
  const before = db.prepare("SELECT id,name,email,role,active FROM users WHERE id=? AND role NOT IN ('customer','owner')").get(req.params.id);
  if (!before) throw new HttpError(404, 'NOT_FOUND', 'Staff member not found.');
  const after = { ...before, role: input.role ?? before.role, active: input.active ?? Boolean(before.active) };
  db.prepare('UPDATE users SET role=?,active=?,updated_at=? WHERE id=?').run(after.role, Number(after.active), new Date().toISOString(), before.id);
  if (!after.active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(before.id);
  audit(req.user.id, 'update', 'staff', before.id, before, after);
  res.json({ staff: after });
});

adminBusinessRouter.get('/audit', owners, (req, res) => {
  const input = validate(z.strictObject({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }), req.query);
  const logs = db.prepare('SELECT a.id,a.action,a.entity,a.entity_id AS entityId,a.before_json AS beforeJson,a.after_json AS afterJson,a.created_at AS createdAt,u.name AS actorName FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT ? OFFSET ?').all(input.limit, input.offset)
    .map(({ beforeJson, afterJson, ...row }) => ({ ...row, before: beforeJson ? JSON.parse(beforeJson) : null, after: afterJson ? JSON.parse(afterJson) : null }));
  res.json({ logs, total: db.prepare('SELECT COUNT(*) AS count FROM audit_logs').get().count });
});
