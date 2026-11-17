import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, menuRow, menuSelect, readKeyValues } from '../db.js';
import { HttpError, rateLimit, requireAuth, requireCsrf, tokenHash, validate } from '../http.js';

export const publicRouter = Router();

function lagosNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function orderDetails(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!order) return null;
  const items = db.prepare('SELECT id,menu_item_id AS menuItemId,name,unit_price AS unitPrice,quantity,options_json AS optionsJson,line_total AS lineTotal FROM order_items WHERE order_id=?').all(id).map(({ optionsJson, ...item }) => ({ ...item, options: JSON.parse(optionsJson || '[]') }));
  const events = db.prepare('SELECT status,note,created_at AS createdAt FROM order_events WHERE order_id=? ORDER BY created_at').all(id);
  const { tracking_token_hash: _tracking, ...safeOrder } = order;
  return { ...safeOrder, items, events };
}

publicRouter.get('/public/menu', (req, res) => {
  const categories = db.prepare('SELECT id,name,position FROM categories WHERE active=1 ORDER BY position,name').all();
  const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const popular = req.query.popular === 'true';
  let sql = `${menuSelect} WHERE c.active=1`;
  const params = [];
  if (category) { sql += ' AND m.category_id=?'; params.push(category); }
  if (q) { sql += ' AND m.name LIKE ?'; params.push(`%${q}%`); }
  if (popular) sql += ' AND m.popular=1';
  sql += ' ORDER BY c.position,m.created_at,m.name';
  const items = db.prepare(sql).all(...params).map(menuRow);
  res.json({ categories, items });
});

publicRouter.get('/public/settings', (_req, res) => {
  const settings = readKeyValues('settings');
  const content = readKeyValues('content');
  res.json({ settings, content });
});

publicRouter.get('/public/reviews', (_req, res) => {
  const reviews = db.prepare(`SELECT r.id,r.rating,r.body,r.created_at AS createdAt,u.name AS customerName
    FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.status='Approved' ORDER BY r.created_at DESC LIMIT 30`).all();
  res.json({ reviews });
});

const selectedOptionSchema = z.strictObject({ groupId: z.string().min(1).max(80), choiceId: z.string().min(1).max(80) });
const orderSchema = z.strictObject({
  customerName: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(7).max(30),
  email: z.union([z.email().max(254), z.literal('')]).default(''),
  fulfilment: z.enum(['pickup', 'delivery']),
  deliveryAddress: z.string().trim().max(300).default(''),
  instructions: z.string().trim().max(500).default(''),
  paymentMethod: z.enum(['pay_on_pickup', 'pay_on_delivery']),
  promotionCode: z.string().trim().max(40).default(''),
  items: z.array(z.strictObject({ menuItemId: z.string().min(1).max(80), quantity: z.number().int().min(1).max(99), options: z.array(selectedOptionSchema).max(12).default([]) })).min(1).max(40),
});

function pricedOptions(groups, selections) {
  if (!Array.isArray(groups)) throw new HttpError(500, 'MENU_OPTIONS_INVALID', 'Menu options are not configured correctly.');
  const selectedIds = new Set();
  const result = [];
  let extra = 0;
  for (const selection of selections) {
    if (selectedIds.has(selection.groupId)) throw new HttpError(400, 'OPTION_DUPLICATE', 'Select one choice per option group.');
    selectedIds.add(selection.groupId);
    const group = groups.find((entry) => entry.id === selection.groupId);
    const choice = group?.choices?.find((entry) => entry.id === selection.choiceId);
    if (!group || !choice) throw new HttpError(400, 'OPTION_INVALID', 'A selected meal option is not available.');
    const delta = Number(choice.priceDelta || 0);
    if (!Number.isSafeInteger(delta) || delta < 0) throw new HttpError(500, 'MENU_OPTIONS_INVALID', 'Menu options are not configured correctly.');
    extra += delta;
    result.push({ groupId: group.id, groupName: group.name, choiceId: choice.id, choiceName: choice.name, priceDelta: delta });
  }
  for (const group of groups) if (group.required && !selectedIds.has(group.id)) throw new HttpError(400, 'OPTION_REQUIRED', `Choose ${group.name}.`);
  return { extra, selected: result };
}

publicRouter.post('/orders', rateLimit('orders', 20, 60 * 60 * 1000), (req, res) => {
  const body = { ...req.body };
  if ('fulfillment' in body) { body.fulfilment = body.fulfillment; delete body.fulfillment; }
  if ('address' in body) { body.deliveryAddress = body.address; delete body.address; }
  if ('notes' in body) { body.instructions = body.notes; delete body.notes; }
  if (Array.isArray(body.items)) body.items = body.items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const { id, ...rest } = item;
    return { ...rest, menuItemId: rest.menuItemId || id };
  });
  if (!body.paymentMethod && body.fulfilment) body.paymentMethod = body.fulfilment === 'delivery' ? 'pay_on_delivery' : 'pay_on_pickup';
  const input = validate(orderSchema, body);
  const trackingToken = randomBytes(24).toString('hex');
  const id = randomUUID();
  const order = db.transaction(() => {
    const settings = readKeyValues('settings');
    if (settings.acceptingOrders === false) throw new HttpError(503, 'ORDERING_PAUSED', 'Ordering is currently paused.');
    if (input.fulfilment === 'delivery' && !settings.deliveryEnabled) throw new HttpError(400, 'DELIVERY_UNAVAILABLE', 'Delivery is not currently available.');
    if (input.fulfilment === 'delivery' && !input.deliveryAddress) throw new HttpError(400, 'ADDRESS_REQUIRED', 'Enter a delivery address.');
    if (input.fulfilment === 'pickup' && input.paymentMethod !== 'pay_on_pickup') throw new HttpError(400, 'PAYMENT_METHOD_INVALID', 'Select pay on pickup.');
    if (input.fulfilment === 'delivery' && input.paymentMethod !== 'pay_on_delivery') throw new HttpError(400, 'PAYMENT_METHOD_INVALID', 'Select pay on delivery.');

    const lines = [];
    let subtotal = 0;
    for (const requested of input.items) {
      const item = db.prepare('SELECT id,name,price,available,options_json FROM menu_items WHERE id=?').get(requested.menuItemId);
      if (!item || !item.available) throw new HttpError(409, 'ITEM_UNAVAILABLE', 'A meal in your basket is no longer available.');
      const { extra, selected } = pricedOptions(JSON.parse(item.options_json || '[]'), requested.options);
      const unitPrice = item.price + extra;
      const lineTotal = unitPrice * requested.quantity;
      if (!Number.isSafeInteger(lineTotal) || lineTotal <= 0) throw new HttpError(400, 'TOTAL_INVALID', 'The order total is invalid.');
      subtotal += lineTotal;
      lines.push({ id: randomUUID(), menuItemId: item.id, name: item.name, unitPrice, quantity: requested.quantity, options: selected, lineTotal });
    }
    if (!Number.isSafeInteger(subtotal) || subtotal <= 0) throw new HttpError(400, 'TOTAL_INVALID', 'The order total is invalid.');

    let promotion = null;
    let discount = 0;
    if (input.promotionCode) {
      promotion = db.prepare('SELECT * FROM promotions WHERE code=? COLLATE NOCASE').get(input.promotionCode);
      const now = new Date().toISOString();
      if (!promotion || !promotion.active || (promotion.starts_at && promotion.starts_at > now) || (promotion.expires_at && promotion.expires_at < now) || (promotion.usage_limit !== null && promotion.used_count >= promotion.usage_limit) || subtotal < promotion.minimum_spend) {
        throw new HttpError(400, 'PROMOTION_INVALID', 'This discount code is not available for this order.');
      }
      discount = promotion.kind === 'percent' ? Math.floor(subtotal * promotion.value / 100) : promotion.value;
      discount = Math.min(subtotal, discount);
      db.prepare('UPDATE promotions SET used_count=used_count+1 WHERE id=?').run(promotion.id);
    }
    const deliveryFee = input.fulfilment === 'delivery' ? Number(settings.deliveryFee || 0) : 0;
    if (!Number.isSafeInteger(deliveryFee) || deliveryFee < 0) throw new HttpError(500, 'DELIVERY_FEE_INVALID', 'Delivery is not configured correctly.');
    const total = subtotal - discount + deliveryFee;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO orders (id,tracking_token_hash,user_id,customer_name,phone,email,fulfilment,delivery_address,instructions,subtotal,delivery_fee,discount,promotion_id,total,status,payment_method,payment_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Received',?,'unpaid',?,?)`).run(id, tokenHash(trackingToken), req.user?.id || null, input.customerName, input.phone, input.email, input.fulfilment, input.deliveryAddress, input.instructions, subtotal, deliveryFee, discount, promotion?.id || null, total, input.paymentMethod, now, now);
    const insertLine = db.prepare('INSERT INTO order_items (id,order_id,menu_item_id,name,unit_price,quantity,options_json,line_total) VALUES (?,?,?,?,?,?,?,?)');
    for (const line of lines) insertLine.run(line.id, id, line.menuItemId, line.name, line.unitPrice, line.quantity, JSON.stringify(line.options), line.lineTotal);
    db.prepare('INSERT INTO order_events (id,order_id,actor_id,status,note,created_at) VALUES (?,?,NULL,\'Received\',\'\',?)').run(randomUUID(), id, now);
    return orderDetails(id);
  })();
  res.status(201).json({ order, trackingToken });
});

publicRouter.get('/orders/:id', (req, res) => {
  const order = db.prepare('SELECT id,user_id,tracking_token_hash FROM orders WHERE id=?').get(req.params.id);
  if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found.');
  const token = req.get('X-Order-Token') || '';
  const authorized = req.user?.id === order.user_id || ['owner', 'administrator', 'manager', 'cashier', 'kitchen', 'delivery'].includes(req.user?.role) || (token && tokenHash(token) === order.tracking_token_hash);
  if (!authorized) throw new HttpError(404, 'NOT_FOUND', 'Order not found.');
  res.set('Cache-Control', 'no-store');
  res.json({ order: orderDetails(order.id) });
});

const availabilitySchema = z.strictObject({ date: z.string(), partySize: z.coerce.number().int().min(1).max(30) });
publicRouter.get('/reservations/availability', (req, res) => {
  const input = validate(availabilitySchema, req.query);
  const settings = readKeyValues('settings');
  if (!settings.reservationsEnabled) throw new HttpError(503, 'RESERVATIONS_PAUSED', 'Reservations are not open yet.');
  const now = lagosNow();
  if (!validDate(input.date) || input.date < now.date) throw new HttpError(400, 'DATE_INVALID', 'Choose a future reservation date.');
  const slots = Array.isArray(settings.reservationSlots) ? settings.reservationSlots : [];
  const available = slots.filter((time) => (input.date > now.date || time > now.time) && db.prepare(`SELECT t.id FROM restaurant_tables t WHERE t.active=1 AND t.seats>=? AND NOT EXISTS (
    SELECT 1 FROM reservations r WHERE r.table_id=t.id AND r.reservation_date=? AND r.reservation_time=? AND r.status IN ('Pending','Confirmed')) LIMIT 1`).get(input.partySize, input.date, time));
  res.json({ date: input.date, partySize: input.partySize, slots: available });
});

const reservationSchema = z.strictObject({
  customerName: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(7).max(30),
  email: z.union([z.email().max(254), z.literal('')]).default(''),
  date: z.string(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  partySize: z.number().int().min(1).max(30),
  requests: z.string().trim().max(500).default(''),
});

publicRouter.post('/reservations', rateLimit('reservations', 10, 60 * 60 * 1000), (req, res) => {
  const body = { ...req.body };
  if ('name' in body) { body.customerName = body.name; delete body.name; }
  if ('guests' in body) { body.partySize = body.guests; delete body.guests; }
  if ('notes' in body) { body.requests = body.notes; delete body.notes; }
  const input = validate(reservationSchema, body);
  const trackingToken = randomBytes(24).toString('hex');
  const reservation = db.transaction(() => {
    const settings = readKeyValues('settings');
    if (!settings.reservationsEnabled) throw new HttpError(503, 'RESERVATIONS_PAUSED', 'Reservations are not open yet.');
    const now = lagosNow();
    if (!validDate(input.date) || input.date < now.date) throw new HttpError(400, 'DATE_INVALID', 'Choose a future reservation date.');
    if (input.date === now.date && input.time <= now.time) throw new HttpError(400, 'TIME_PASSED', 'Choose a future reservation time.');
    if (!Array.isArray(settings.reservationSlots) || !settings.reservationSlots.includes(input.time)) throw new HttpError(400, 'TIME_INVALID', 'Choose an available reservation time.');
    const table = db.prepare(`SELECT t.id,t.label,t.seats FROM restaurant_tables t WHERE t.active=1 AND t.seats>=? AND NOT EXISTS (
      SELECT 1 FROM reservations r WHERE r.table_id=t.id AND r.reservation_date=? AND r.reservation_time=? AND r.status IN ('Pending','Confirmed')) ORDER BY t.seats,t.label LIMIT 1`).get(input.partySize, input.date, input.time);
    if (!table) throw new HttpError(409, 'SLOT_UNAVAILABLE', 'This reservation time is no longer available.');
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare(`INSERT INTO reservations (id,tracking_token_hash,user_id,table_id,customer_name,phone,email,reservation_date,reservation_time,party_size,requests,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'Pending',?,?)`).run(id, tokenHash(trackingToken), req.user?.id || null, table.id, input.customerName, input.phone, input.email, input.date, input.time, input.partySize, input.requests, createdAt, createdAt);
    return { id, date: input.date, time: input.time, partySize: input.partySize, status: 'Pending', table: table.label, customerName: input.customerName };
  })();
  res.status(201).json({ reservation, trackingToken });
});

publicRouter.get('/reservations/:id', (req, res) => {
  const row = db.prepare('SELECT r.*,t.label AS table_label FROM reservations r JOIN restaurant_tables t ON t.id=r.table_id WHERE r.id=?').get(req.params.id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Reservation not found.');
  const token = req.get('X-Reservation-Token') || '';
  const authorized = req.user?.id === row.user_id || ['owner', 'administrator', 'manager', 'cashier'].includes(req.user?.role) || (token && tokenHash(token) === row.tracking_token_hash);
  if (!authorized) throw new HttpError(404, 'NOT_FOUND', 'Reservation not found.');
  const { tracking_token_hash: _tracking, ...reservation } = row;
  res.set('Cache-Control', 'no-store');
  res.json({ reservation });
});

const reviewSchema = z.strictObject({ orderId: z.string().uuid().optional(), rating: z.number().int().min(1).max(5), body: z.string().trim().min(10).max(1500) });
publicRouter.post('/reviews', requireAuth, requireCsrf, (req, res) => {
  const body = { ...req.body };
  if ('comment' in body) { body.body = body.comment; delete body.comment; }
  delete body.name;
  const input = validate(reviewSchema, body);
  const order = input.orderId
    ? db.prepare('SELECT id,status,user_id FROM orders WHERE id=?').get(input.orderId)
    : db.prepare(`SELECT o.id,o.status,o.user_id FROM orders o LEFT JOIN reviews r ON r.order_id=o.id
        WHERE o.user_id=? AND o.status='Completed' AND r.id IS NULL ORDER BY o.created_at DESC LIMIT 1`).get(req.user.id);
  if (!order || order.user_id !== req.user.id || order.status !== 'Completed') throw new HttpError(403, 'REVIEW_NOT_ALLOWED', 'Only completed account orders can be reviewed.');
  if (db.prepare('SELECT id FROM reviews WHERE order_id=?').get(order.id)) throw new HttpError(409, 'ALREADY_REVIEWED', 'This order has already been reviewed.');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO reviews (id,user_id,order_id,rating,body,status,created_at,updated_at) VALUES (?,?,?,?,?,\'Pending\',?,?)').run(id, req.user.id, order.id, input.rating, input.body, now, now);
  res.status(201).json({ review: { id, rating: input.rating, body: input.body, status: 'Pending', createdAt: now } });
});

publicRouter.post('/payments/initialize', (_req, _res) => {
  throw new HttpError(503, 'PAYMENTS_NOT_CONFIGURED', 'Online payment will be available after a verified payment provider is configured.');
});
