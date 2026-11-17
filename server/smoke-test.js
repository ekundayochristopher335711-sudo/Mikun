import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import bcrypt from 'bcryptjs';

const tempDirectory = mkdtempSync(join(tmpdir(), 'mikun-api-smoke-'));
process.env.DATABASE_PATH = join(tempDirectory, 'test.sqlite');
process.env.MEDIA_DIR = join(tempDirectory, 'media');

const { app } = await import('./index.js');
const { db } = await import('./db.js');
let server;

try {
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function api(method, path, body, auth) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(auth?.cookie ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrfToken } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    return { status: response.status, data, cookie };
  }

  const health = await api('GET', '/health');
  assert.equal(health.status, 200);
  const menu = await api('GET', '/public/menu');
  assert.equal(menu.data.items.length, 22);
  const settings = await api('GET', '/public/settings');
  assert.equal(settings.data.settings.currency, '₦');

  const guestOrder = await api('POST', '/orders', { customerName: 'Test Guest', phone: '08000000000', fulfillment: 'pickup', items: [{ id: 'dish-1', quantity: 2 }], notes: 'Less pepper' });
  assert.equal(guestOrder.status, 201, JSON.stringify(guestOrder.data));
  assert.equal(guestOrder.data.order.total, 3000);
  const guestId = guestOrder.data.order.id;
  assert.equal((await api('GET', `/orders/${guestId}`)).status, 404);
  const tracked = await fetch(`${base}/api/orders/${guestId}`, { headers: { 'X-Order-Token': guestOrder.data.trackingToken } });
  assert.equal(tracked.status, 200);
  assert.equal((await api('POST', '/payments/initialize', {})).status, 503);

  const customer = await api('POST', '/auth/register', { name: 'Test Customer', email: 'test@example.com', phone: '08000000001', password: 'StrongTestPass123!' });
  assert.equal(customer.status, 201, JSON.stringify(customer.data));
  const customerAuth = { cookie: customer.cookie, csrfToken: customer.data.csrfToken };
  assert.equal((await api('GET', '/admin/dashboard', undefined, customerAuth)).status, 403);
  const accountOrder = await api('POST', '/orders', { customerName: 'Test Customer', phone: '08000000001', fulfillment: 'pickup', items: [{ id: 'dish-2', quantity: 1 }] }, customerAuth);
  assert.equal(accountOrder.status, 201, JSON.stringify(accountOrder.data));

  const now = new Date().toISOString();
  const ownerId = randomUUID();
  db.prepare("INSERT INTO users (id,name,email,phone,password_hash,role,active,created_at,updated_at) VALUES (?,?,?,?,?,'owner',1,?,?)")
    .run(ownerId, 'Test Owner', 'owner@example.com', '', await bcrypt.hash('StrongOwnerPass123!', 12), now, now);
  const login = await api('POST', '/auth/login', { email: 'owner@example.com', password: 'StrongOwnerPass123!' });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const ownerAuth = { cookie: login.cookie, csrfToken: login.data.csrfToken };
  assert.equal((await api('POST', '/admin/tables', { label: 'T1', seats: 4 }, { ...ownerAuth, csrfToken: 'wrong' })).status, 403);
  const uploadedImage = await fetch(`${base}/api/admin/media`, {
    method: 'POST',
    headers: { Cookie: ownerAuth.cookie, 'X-CSRF-Token': ownerAuth.csrfToken, 'Content-Type': 'image/png' },
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Q2cAAAAASUVORK5CYII=', 'base64'),
  });
  assert.equal(uploadedImage.status, 201);
  const image = await uploadedImage.json();
  assert.equal((await fetch(`${base}${image.url}`)).status, 200);
  const newMenu = await api('POST', '/admin/menu', { categoryId: 'dishes', name: 'Temporary test dish', price: 1500, imageUrl: image.url }, ownerAuth);
  assert.equal(newMenu.status, 201, JSON.stringify(newMenu.data));
  assert.equal((await api('PATCH', `/admin/menu/${newMenu.data.item.id}`, { available: false }, ownerAuth)).data.item.available, false);
  assert.equal((await api('DELETE', `/admin/menu/${newMenu.data.item.id}`, {}, ownerAuth)).status, 200);
  const promotion = await api('POST', '/admin/promotions', { code: 'SMOKE10', kind: 'percent', value: 10 }, ownerAuth);
  assert.equal(promotion.status, 201, JSON.stringify(promotion.data));
  const discountedOrder = await api('POST', '/orders', { customerName: 'Test Guest', phone: '08000000000', fulfillment: 'pickup', promotionCode: 'SMOKE10', items: [{ id: 'dish-1', quantity: 1 }] });
  assert.equal(discountedOrder.status, 201, JSON.stringify(discountedOrder.data));
  assert.equal(discountedOrder.data.order.total, 1350);
  assert.equal((await api('POST', '/admin/tables', { label: 'T1', seats: 4 }, ownerAuth)).status, 201);
  assert.equal((await api('PATCH', '/admin/settings', { reservationsEnabled: true }, ownerAuth)).status, 200);
  assert.equal((await api('PATCH', '/admin/settings', { reservationSlots: ['00:00', ...settings.data.settings.reservationSlots] }, ownerAuth)).status, 200);

  const lagosParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  const lagosToday = `${lagosParts.year}-${lagosParts.month}-${lagosParts.day}`;
  const todaySlots = await api('GET', `/reservations/availability?date=${lagosToday}&partySize=2`);
  assert.equal(todaySlots.status, 200);
  assert.equal(todaySlots.data.slots.includes('00:00'), false, 'Past slots today must be hidden');
  const pastBooking = await api('POST', '/reservations', { name: 'Test Guest', phone: '08000000000', date: lagosToday, time: '00:00', guests: 2 });
  assert.equal(pastBooking.status, 400, 'Past slots today must not be bookable');

  const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const slots = await api('GET', `/reservations/availability?date=${tomorrow}&partySize=2`);
  assert.equal(slots.status, 200, JSON.stringify(slots.data));
  const reservationBody = { name: 'Test Guest', phone: '08000000000', date: tomorrow, time: slots.data.slots[0], guests: 2, notes: 'Window seat' };
  const reservation = await api('POST', '/reservations', reservationBody);
  assert.equal(reservation.status, 201, JSON.stringify(reservation.data));
  assert.equal((await api('POST', '/reservations', reservationBody)).status, 409);

  const accountId = accountOrder.data.order.id;
  for (const status of ['Confirmed', 'Preparing', 'Ready', 'Completed']) {
    const changed = await api('PATCH', `/admin/orders/${accountId}/status`, { status }, ownerAuth);
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
  }
  const paid = await api('PATCH', `/admin/orders/${accountId}/payment`, { status: 'paid' }, ownerAuth);
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  assert.equal((await api('PATCH', `/admin/orders/${guestId}/status`, { status: 'Cancelled' }, ownerAuth)).status, 200);
  assert.equal((await api('PATCH', `/admin/orders/${guestId}/payment`, { status: 'paid' }, ownerAuth)).status, 409, 'Cancelled orders must not be marked paid');
  const review = await api('POST', '/reviews', { name: 'Test Customer', rating: 5, comment: 'A delicious meal, thank you.' }, customerAuth);
  assert.equal(review.status, 201, JSON.stringify(review.data));
  assert.equal((await api('GET', '/public/reviews')).data.reviews.length, 0);
  assert.equal((await api('PATCH', `/admin/reviews/${review.data.review.id}`, { status: 'Approved' }, ownerAuth)).status, 200);
  assert.equal((await api('GET', '/public/reviews')).data.reviews.length, 1);
  const dashboard = await api('GET', '/admin/dashboard', undefined, ownerAuth);
  assert.equal(dashboard.status, 200);
  assert.equal(typeof dashboard.data.recordedRevenue, 'number');
  const boundary = new Date(`${dashboard.data.today}T00:30:00+01:00`).toISOString();
  db.prepare('UPDATE orders SET created_at=? WHERE id=?').run(boundary, guestId);
  const boundaryDashboard = await api('GET', '/admin/dashboard', undefined, ownerAuth);
  const start = new Date(`${dashboard.data.today}T00:00:00+01:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const expectedToday = db.prepare('SELECT COUNT(*) AS count FROM orders WHERE created_at>=? AND created_at<?').get(start.toISOString(), end.toISOString()).count;
  assert.equal(boundaryDashboard.data.totalOrders, expectedToday, 'Lagos midnight orders must count toward today');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_logs').get().count > 0, true);

  console.log('API smoke test passed: seed, orders, tracking, auth, CSRF, RBAC, menu CRUD, image upload, promotions, reservations, reviews, cash payment, dashboard, and disabled online payments.');
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  db.close();
  const root = realpathSync(tmpdir());
  const target = realpathSync(tempDirectory);
  const inside = relative(root, target);
  if (!inside || inside.startsWith('..') || inside.includes(':')) throw new Error('Refusing to remove a test directory outside the system temp folder.');
  rmSync(target, { recursive: true, force: true });
}
