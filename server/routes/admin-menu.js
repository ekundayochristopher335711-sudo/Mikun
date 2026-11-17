import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { audit, db, menuRow, menuSelect } from '../db.js';
import { HttpError, requireCsrf, requireRole, validate } from '../http.js';

export const adminMenuRouter = Router();
const canEditMenu = requireRole('owner', 'administrator', 'manager');
const canViewMenu = requireRole('owner', 'administrator', 'manager', 'cashier', 'kitchen', 'delivery');

const categorySchema = z.strictObject({ name: z.string().trim().min(2).max(50), position: z.number().int().min(0).max(1000).default(0), active: z.boolean().default(true) });
const choiceSchema = z.strictObject({ id: z.string().min(1).max(80), name: z.string().trim().min(1).max(80), priceDelta: z.number().int().min(0).max(100000) });
const optionSchema = z.strictObject({ id: z.string().min(1).max(80), name: z.string().trim().min(1).max(80), required: z.boolean().default(false), choices: z.array(choiceSchema).min(1).max(30) });
const itemSchema = z.strictObject({
  categoryId: z.string().min(1).max(80),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).default(''),
  price: z.number().int().min(1).max(10000000),
  imageUrl: z.union([z.url({ protocol: /^https$/ }), z.string().regex(/^\/(?!\/)[a-zA-Z0-9_./-]+$/), z.literal('')]).default(''),
  available: z.boolean().default(true),
  popular: z.boolean().default(false),
  options: z.array(optionSchema).max(20).default([]),
});

function assertCategory(id) {
  if (!db.prepare('SELECT id FROM categories WHERE id=?').get(id)) throw new HttpError(400, 'CATEGORY_NOT_FOUND', 'Choose an existing category.');
}

function validateOptions(groups) {
  const groupIds = new Set();
  for (const group of groups) {
    if (groupIds.has(group.id)) throw new HttpError(400, 'OPTION_DUPLICATE', 'Option group IDs must be unique.');
    groupIds.add(group.id);
    const choiceIds = new Set();
    for (const choice of group.choices) {
      if (choiceIds.has(choice.id)) throw new HttpError(400, 'CHOICE_DUPLICATE', 'Choice IDs must be unique within a group.');
      choiceIds.add(choice.id);
    }
  }
}

adminMenuRouter.get('/categories', canViewMenu, (_req, res) => {
  res.json({ categories: db.prepare('SELECT id,name,position,active FROM categories ORDER BY position,name').all().map((row) => ({ ...row, active: Boolean(row.active) })) });
});

adminMenuRouter.post('/categories', canEditMenu, requireCsrf, (req, res) => {
  const input = validate(categorySchema, req.body);
  const id = randomUUID();
  db.prepare('INSERT INTO categories (id,name,position,active) VALUES (?,?,?,?)').run(id, input.name, input.position, Number(input.active));
  audit(req.user.id, 'create', 'category', id, null, input);
  res.status(201).json({ category: { id, ...input } });
});

adminMenuRouter.patch('/categories/:id', canEditMenu, requireCsrf, (req, res) => {
  const input = validate(categorySchema.partial(), req.body);
  const before = db.prepare('SELECT id,name,position,active FROM categories WHERE id=?').get(req.params.id);
  if (!before) throw new HttpError(404, 'NOT_FOUND', 'Category not found.');
  const after = { id: before.id, name: input.name ?? before.name, position: input.position ?? before.position, active: input.active === undefined ? Boolean(before.active) : input.active };
  db.prepare('UPDATE categories SET name=?,position=?,active=? WHERE id=?').run(after.name, after.position, Number(after.active), before.id);
  audit(req.user.id, 'update', 'category', before.id, before, after);
  res.json({ category: after });
});

adminMenuRouter.delete('/categories/:id', canEditMenu, requireCsrf, (req, res) => {
  const before = db.prepare('SELECT id,name,position,active FROM categories WHERE id=?').get(req.params.id);
  if (!before) throw new HttpError(404, 'NOT_FOUND', 'Category not found.');
  const count = db.prepare('SELECT COUNT(*) AS count FROM menu_items WHERE category_id=?').get(before.id).count;
  if (count) throw new HttpError(409, 'CATEGORY_NOT_EMPTY', 'Move or remove the meals in this category first.');
  db.prepare('DELETE FROM categories WHERE id=?').run(before.id);
  audit(req.user.id, 'delete', 'category', before.id, before, null);
  res.json({ ok: true });
});

adminMenuRouter.get('/menu', canViewMenu, (_req, res) => {
  res.json({ items: db.prepare(`${menuSelect} ORDER BY c.position,m.created_at,m.name`).all().map(menuRow) });
});

adminMenuRouter.post('/menu', canEditMenu, requireCsrf, (req, res) => {
  const input = validate(itemSchema, req.body);
  assertCategory(input.categoryId);
  validateOptions(input.options);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO menu_items (id,category_id,name,description,price,image_url,available,popular,options_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.categoryId, input.name, input.description, input.price, input.imageUrl || null, Number(input.available), Number(input.popular), JSON.stringify(input.options), now, now);
  audit(req.user.id, 'create', 'menu_item', id, null, input);
  res.status(201).json({ item: menuRow(db.prepare(`${menuSelect} WHERE m.id=?`).get(id)) });
});

adminMenuRouter.patch('/menu/:id', canEditMenu, requireCsrf, (req, res) => {
  const input = validate(itemSchema.partial(), req.body);
  if (!Object.keys(input).length) throw new HttpError(400, 'NO_CHANGES', 'No menu changes were supplied.');
  const before = menuRow(db.prepare(`${menuSelect} WHERE m.id=?`).get(req.params.id));
  if (!before) throw new HttpError(404, 'NOT_FOUND', 'Menu item not found.');
  const after = { ...before, ...input };
  assertCategory(after.categoryId);
  validateOptions(after.options);
  db.prepare(`UPDATE menu_items SET category_id=?,name=?,description=?,price=?,image_url=?,available=?,popular=?,options_json=?,updated_at=? WHERE id=?`)
    .run(after.categoryId, after.name, after.description, after.price, after.imageUrl || null, Number(after.available), Number(after.popular), JSON.stringify(after.options), new Date().toISOString(), before.id);
  audit(req.user.id, 'update', 'menu_item', before.id, before, after);
  res.json({ item: menuRow(db.prepare(`${menuSelect} WHERE m.id=?`).get(before.id)) });
});

adminMenuRouter.delete('/menu/:id', canEditMenu, requireCsrf, (req, res) => {
  const before = menuRow(db.prepare(`${menuSelect} WHERE m.id=?`).get(req.params.id));
  if (!before) throw new HttpError(404, 'NOT_FOUND', 'Menu item not found.');
  db.prepare('DELETE FROM menu_items WHERE id=?').run(before.id);
  audit(req.user.id, 'delete', 'menu_item', before.id, before, null);
  res.json({ ok: true });
});
