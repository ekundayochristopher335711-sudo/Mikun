import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { audit, db } from '../db.js';
import { HttpError, requireCsrf, requireRole, validate } from '../http.js';

export const adminOperationsRouter = Router();
const operators = ['owner', 'administrator', 'manager', 'cashier'];
const kitchenRoles = [...operators, 'kitchen'];
const fulfillmentRoles = [...kitchenRoles, 'delivery'];
const canManage = requireRole(...operators);
const canUpdateOrders = requireRole(...fulfillmentRoles);

const orderStatus = z.enum(['Received', 'Confirmed', 'Preparing', 'Ready', 'Out for Delivery', 'Completed', 'Rejected', 'Cancelled']);
const allowedTransitions = {
  Received: ['Confirmed', 'Rejected', 'Cancelled'],
  Confirmed: ['Preparing', 'Cancelled'],
  Preparing: ['Ready', 'Cancelled'],
  Ready: ['Out for Delivery', 'Completed', 'Cancelled'],
  'Out for Delivery': ['Completed', 'Cancelled'],
  Completed: [], Rejected: [], Cancelled: [],
};

function orderView(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!order) return null;
  const { tracking_token_hash: _private, ...safe } = order;
  const items = db.prepare('SELECT id,menu_item_id AS menuItemId,name,unit_price AS unitPrice,quantity,options_json AS optionsJson,line_total AS lineTotal FROM order_items WHERE order_id=?').all(id)
    .map(({ optionsJson, ...item }) => ({ ...item, options: JSON.parse(optionsJson || '[]') }));
  const events = db.prepare('SELECT e.status,e.note,e.created_at AS createdAt,u.name AS actorName FROM order_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.order_id=? ORDER BY e.created_at').all(id);
  return { ...safe, items, events };
}

adminOperationsRouter.get('/dashboard', requireRole(...fulfillmentRoles), (_req, res) => {
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  const today = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const dayStart = new Date(`${today}T00:00:00+01:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const orders = db.prepare(`SELECT COUNT(*) AS totalOrders,
    COALESCE(SUM(CASE WHEN status IN ('Received','Confirmed','Preparing','Ready','Out for Delivery') THEN 1 ELSE 0 END),0) AS openOrders,
    COALESCE(SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END),0) AS completedOrders,
    COALESCE(SUM(CASE WHEN status='Completed' AND payment_status='paid' THEN total ELSE 0 END),0) AS recordedRevenue
    FROM orders WHERE created_at>=? AND created_at<?`).get(dayStart.toISOString(), dayEnd.toISOString());
  const pendingReservations = db.prepare("SELECT COUNT(*) AS count FROM reservations WHERE status='Pending'").get().count;
  const pendingReviews = db.prepare("SELECT COUNT(*) AS count FROM reviews WHERE status='Pending'").get().count;
  const lowAvailability = db.prepare('SELECT COUNT(*) AS count FROM menu_items WHERE available=0').get().count;
  const latestOrders = db.prepare('SELECT id,customer_name AS customerName,total,status,fulfilment,created_at AS createdAt FROM orders ORDER BY created_at DESC LIMIT 8').all();
  res.json({ today, ...orders, pendingReservations, pendingReviews, unavailableMenuItems: lowAvailability, latestOrders });
});

adminOperationsRouter.get('/orders', requireRole(...fulfillmentRoles), (req, res) => {
  const filter = validate(z.strictObject({ status: orderStatus.optional(), q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }), req.query);
  let where = 'WHERE 1=1';
  const params = [];
  if (filter.status) { where += ' AND status=?'; params.push(filter.status); }
  if (filter.q) { where += ' AND (customer_name LIKE ? OR phone LIKE ? OR id=?)'; params.push(`%${filter.q}%`, `%${filter.q}%`, filter.q); }
  const total = db.prepare(`SELECT COUNT(*) AS count FROM orders ${where}`).get(...params).count;
  const orders = db.prepare(`SELECT id,customer_name AS customerName,phone,fulfilment,total,status,payment_method AS paymentMethod,payment_status AS paymentStatus,created_at AS createdAt,updated_at AS updatedAt FROM orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, filter.limit, filter.offset);
  res.json({ orders, total });
});

adminOperationsRouter.get('/orders/:id', requireRole(...fulfillmentRoles), (req, res) => {
  const order = orderView(req.params.id);
  if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found.');
  res.json({ order });
});

adminOperationsRouter.patch('/orders/:id/status', canUpdateOrders, requireCsrf, (req, res) => {
  const input = validate(z.strictObject({ status: orderStatus, note: z.string().trim().max(500).default('') }), req.body);
  const result = db.transaction(() => {
    const before = db.prepare('SELECT id,status,fulfilment FROM orders WHERE id=?').get(req.params.id);
    if (!before) throw new HttpError(404, 'NOT_FOUND', 'Order not found.');
    if (!allowedTransitions[before.status]?.includes(input.status)) throw new HttpError(409, 'INVALID_TRANSITION', `Cannot move an order from ${before.status} to ${input.status}.`);
    if (input.status === 'Out for Delivery' && before.fulfilment !== 'delivery') throw new HttpError(409, 'INVALID_TRANSITION', 'Pickup orders cannot be marked out for delivery.');
    if (input.status === 'Completed' && before.fulfilment === 'delivery' && before.status !== 'Out for Delivery') throw new HttpError(409, 'INVALID_TRANSITION', 'Delivery orders must be sent out before completion.');
    if (req.user.role === 'kitchen' && !['Preparing', 'Ready'].includes(input.status)) throw new HttpError(403, 'FORBIDDEN', 'Kitchen staff can only update preparation status.');
    if (req.user.role === 'delivery' && !['Out for Delivery', 'Completed'].includes(input.status)) throw new HttpError(403, 'FORBIDDEN', 'Delivery staff can only update delivery status.');
    const now = new Date().toISOString();
    db.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=?').run(input.status, now, before.id);
    db.prepare('INSERT INTO order_events (id,order_id,actor_id,status,note,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), before.id, req.user.id, input.status, input.note, now);
    audit(req.user.id, 'status', 'order', before.id, { status: before.status }, { status: input.status, note: input.note });
    return orderView(before.id);
  })();
  res.json({ order: result });
});

adminOperationsRouter.patch('/orders/:id/payment', canManage, requireCsrf, (req, res) => {
  const input = validate(z.strictObject({ status: z.literal('paid'), note: z.string().trim().max(300).default('') }), req.body);
  const order = db.prepare('SELECT id,payment_method,payment_status,total,status FROM orders WHERE id=?').get(req.params.id);
  if (!order) throw new HttpError(404, 'NOT_FOUND', 'Order not found.');
  if (order.payment_method === 'online') throw new HttpError(409, 'PROVIDER_VERIFICATION_REQUIRED', 'Online payments can only be marked paid by a verified provider callback.');
  if (['Cancelled', 'Rejected'].includes(order.status)) throw new HttpError(409, 'ORDER_CLOSED', 'A cancelled or rejected order cannot be marked paid.');
  if (order.payment_status !== 'unpaid') throw new HttpError(409, 'PAYMENT_ALREADY_UPDATED', 'This payment is already recorded.');
  db.transaction(() => {
    db.prepare("UPDATE orders SET payment_status='paid',updated_at=? WHERE id=?").run(new Date().toISOString(), order.id);
    audit(req.user.id, 'record_cash_payment', 'order', order.id, { paymentStatus: 'unpaid' }, { paymentStatus: input.status, amount: order.total, note: input.note });
  })();
  res.json({ order: orderView(order.id) });
});

adminOperationsRouter.get('/tables', canManage, (_req, res) => {
  res.json({ tables: db.prepare('SELECT id,label,seats,active FROM restaurant_tables ORDER BY label').all().map((table) => ({ ...table, active: Boolean(table.active) })) });
});

const tableSchema = z.strictObject({ label: z.string().trim().min(1).max(40), seats: z.number().int().min(1).max(30), active: z.boolean().default(true) });
adminOperationsRouter.post('/tables', canManage, requireCsrf, (req, res) => {
  const input = validate(tableSchema, req.body);
  const id = randomUUID();
  db.prepare('INSERT INTO restaurant_tables (id,label,seats,active) VALUES (?,?,?,?)').run(id, input.label, input.seats, Number(input.active));
  audit(req.user.id, 'create', 'table', id, null, input);
  res.status(201).json({ table: { id, ...input } });
});

adminOperationsRouter.patch('/tables/:id', canManage, requireCsrf, (req, res) => {
  const input = validate(tableSchema.partial(), req.body);
  const before = db.prepare('SELECT id,label,seats,active FROM restaurant_tables WHERE id=?').get(req.params.id);
  if (!before) throw new HttpError(404, 'NOT_FOUND', 'Table not found.');
  const after = { ...before, ...input, active: input.active ?? Boolean(before.active) };
  db.prepare('UPDATE restaurant_tables SET label=?,seats=?,active=? WHERE id=?').run(after.label, after.seats, Number(after.active), before.id);
  audit(req.user.id, 'update', 'table', before.id, before, after);
  res.json({ table: after });
});

adminOperationsRouter.delete('/tables/:id', canManage, requireCsrf, (req, res) => {
  const before = db.prepare('SELECT id,label,seats,active FROM restaurant_tables WHERE id=?').get(req.params.id);
  if (!before) throw new HttpError(404, 'NOT_FOUND', 'Table not found.');
  if (db.prepare('SELECT 1 FROM reservations WHERE table_id=? LIMIT 1').get(before.id)) throw new HttpError(409, 'TABLE_HAS_RESERVATIONS', 'Deactivate this table to preserve reservation history.');
  db.prepare('DELETE FROM restaurant_tables WHERE id=?').run(before.id);
  audit(req.user.id, 'delete', 'table', before.id, before, null);
  res.json({ ok: true });
});

adminOperationsRouter.get('/reservations', canManage, (req, res) => {
  const filter = validate(z.strictObject({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), status: z.enum(['Pending', 'Confirmed', 'Cancelled', 'Completed']).optional() }), req.query);
  let where = 'WHERE 1=1'; const params = [];
  if (filter.date) { where += ' AND r.reservation_date=?'; params.push(filter.date); }
  if (filter.status) { where += ' AND r.status=?'; params.push(filter.status); }
  const reservations = db.prepare(`SELECT r.id,r.customer_name AS customerName,r.phone,r.email,r.reservation_date AS date,r.reservation_time AS time,r.party_size AS partySize,r.requests,r.status,r.created_at AS createdAt,t.label AS tableLabel FROM reservations r JOIN restaurant_tables t ON t.id=r.table_id ${where} ORDER BY r.reservation_date DESC,r.reservation_time DESC LIMIT 300`).all(...params);
  res.json({ reservations });
});

adminOperationsRouter.patch('/reservations/:id/status', canManage, requireCsrf, (req, res) => {
  const input = validate(z.strictObject({ status: z.enum(['Confirmed', 'Cancelled', 'Completed']) }), req.body);
  const before = db.prepare('SELECT id,status FROM reservations WHERE id=?').get(req.params.id);
  if (!before) throw new HttpError(404, 'NOT_FOUND', 'Reservation not found.');
  const transitions = { Pending: ['Confirmed', 'Cancelled'], Confirmed: ['Completed', 'Cancelled'], Cancelled: [], Completed: [] };
  if (!transitions[before.status].includes(input.status)) throw new HttpError(409, 'INVALID_TRANSITION', 'This reservation cannot move to that status.');
  db.prepare('UPDATE reservations SET status=?,updated_at=? WHERE id=?').run(input.status, new Date().toISOString(), before.id);
  audit(req.user.id, 'status', 'reservation', before.id, before, { status: input.status });
  res.json({ reservation: db.prepare('SELECT id,reservation_date AS date,reservation_time AS time,status FROM reservations WHERE id=?').get(before.id) });
});

adminOperationsRouter.get('/reviews', canManage, (req, res) => {
  const filter = validate(z.strictObject({ status: z.enum(['Pending', 'Approved', 'Hidden']).optional() }), req.query);
  const where = filter.status ? 'WHERE r.status=?' : '';
  const reviews = db.prepare(`SELECT r.id,r.order_id AS orderId,r.rating,r.body,r.status,r.created_at AS createdAt,u.name AS customerName FROM reviews r JOIN users u ON u.id=r.user_id ${where} ORDER BY r.created_at DESC LIMIT 300`).all(...(filter.status ? [filter.status] : []));
  res.json({ reviews });
});

adminOperationsRouter.patch('/reviews/:id', canManage, requireCsrf, (req, res) => {
  const input = validate(z.strictObject({ status: z.enum(['Approved', 'Hidden']) }), req.body);
  const before = db.prepare('SELECT id,status FROM reviews WHERE id=?').get(req.params.id);
  if (!before) throw new HttpError(404, 'NOT_FOUND', 'Review not found.');
  db.prepare('UPDATE reviews SET status=?,updated_at=? WHERE id=?').run(input.status, new Date().toISOString(), before.id);
  audit(req.user.id, 'moderate', 'review', before.id, before, input);
  res.json({ review: db.prepare('SELECT id,rating,body,status,created_at AS createdAt FROM reviews WHERE id=?').get(before.id) });
});
