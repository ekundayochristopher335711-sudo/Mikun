import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { initialContent, initialMenu, initialSettings } from './seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const databasePath = process.env.DATABASE_PATH || join(here, 'data', 'mikun.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','owner','administrator','manager','cashier','kitchen','delivery')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);
CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK (price > 0),
  image_url TEXT,
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
  popular INTEGER NOT NULL DEFAULT 0 CHECK (popular IN (0,1)),
  options_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS menu_items_category_idx ON menu_items(category_id);

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
  value INTEGER NOT NULL CHECK (value > 0),
  minimum_spend INTEGER NOT NULL DEFAULT 0 CHECK (minimum_spend >= 0),
  usage_limit INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  tracking_token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  fulfilment TEXT NOT NULL CHECK (fulfilment IN ('pickup','delivery')),
  delivery_address TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  delivery_fee INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  promotion_id TEXT REFERENCES promotions(id) ON DELETE SET NULL,
  total INTEGER NOT NULL CHECK (total >= 0),
  status TEXT NOT NULL DEFAULT 'Received' CHECK (status IN ('Received','Confirmed','Preparing','Ready','Out for Delivery','Completed','Rejected','Cancelled')),
  payment_method TEXT NOT NULL DEFAULT 'pay_on_pickup' CHECK (payment_method IN ('pay_on_pickup','pay_on_delivery','online')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','pending','paid','refunded','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status, created_at DESC);
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id TEXT REFERENCES menu_items(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  unit_price INTEGER NOT NULL CHECK (unit_price > 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  options_json TEXT NOT NULL DEFAULT '[]',
  line_total INTEGER NOT NULL CHECK (line_total >= 0)
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);
CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  seats INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 30),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  tracking_token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  table_id TEXT NOT NULL REFERENCES restaurant_tables(id) ON DELETE RESTRICT,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  reservation_date TEXT NOT NULL,
  reservation_time TEXT NOT NULL,
  party_size INTEGER NOT NULL CHECK (party_size BETWEEN 1 AND 30),
  requests TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Confirmed','Cancelled','Completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS reservation_slot_unique ON reservations(table_id,reservation_date,reservation_time) WHERE status IN ('Pending','Confirmed');
CREATE INDEX IF NOT EXISTS reservations_date_idx ON reservations(reservation_date,reservation_time);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Hidden')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reviews_status_idx ON reviews(status,created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS content (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);
CREATE TABLE IF NOT EXISTS seed_state (
  name TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
`;

if (db.pragma('user_version', { simple: true }) < 1) {
  db.transaction(() => {
    db.exec(schema);
    db.pragma('user_version = 1');
  })();
} else {
  // CREATE IF NOT EXISTS also lets a database from an early development build
  // acquire tables introduced before the first production deployment.
  db.exec(schema);
}

const seed = db.transaction(() => {
  if (db.prepare("SELECT 1 FROM seed_state WHERE name='initial_menu_v1'").get()) return;
  const now = new Date().toISOString();
  const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (id,name,position,active) VALUES (?,?,?,1)');
  ['Dishes', 'Proteins', 'Drinks'].forEach((name, position) => insertCategory.run(name.toLowerCase(), name, position));
  if (db.prepare('SELECT COUNT(*) AS count FROM menu_items').get().count === 0) {
    const insertItem = db.prepare(`INSERT INTO menu_items (id,category_id,name,price,description,available,popular,options_json,created_at,updated_at)
      VALUES (?,?,?,?, '',1,0,'[]',?,?)`);
    for (const [id, category, name, price] of initialMenu) insertItem.run(id, category.toLowerCase(), name, price, now, now);
  }
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key,value_json,updated_at) VALUES (?,?,?)');
  for (const [key, value] of Object.entries(initialSettings)) insertSetting.run(key, JSON.stringify(value), now);
  const insertContent = db.prepare('INSERT OR IGNORE INTO content (key,value_json,updated_at) VALUES (?,?,?)');
  for (const [key, value] of Object.entries(initialContent)) insertContent.run(key, JSON.stringify(value), now);
  db.prepare("INSERT INTO seed_state (name,created_at) VALUES ('initial_menu_v1',?)").run(now);
});
seed();

export function readKeyValues(table) {
  if (!['settings', 'content'].includes(table)) throw new Error('Invalid key-value table');
  return Object.fromEntries(db.prepare(`SELECT key,value_json FROM ${table}`).all().map((row) => [row.key, JSON.parse(row.value_json)]));
}

export function writeKeyValues(table, changes) {
  if (!['settings', 'content'].includes(table)) throw new Error('Invalid key-value table');
  const statement = db.prepare(`INSERT INTO ${table} (key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`);
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const [key, value] of Object.entries(changes)) statement.run(key, JSON.stringify(value), now);
  })();
}

export function audit(actorId, action, entity, entityId, before = null, after = null) {
  db.prepare('INSERT INTO audit_logs (id,actor_id,action,entity,entity_id,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(randomUUID(), actorId, action, entity, entityId, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), new Date().toISOString());
}

export function menuRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    categoryId: row.category_id,
    category: row.category_name,
    name: row.name,
    description: row.description,
    price: row.price,
    imageUrl: row.image_url,
    available: Boolean(row.available),
    popular: Boolean(row.popular),
    options: JSON.parse(row.options_json || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const menuSelect = `SELECT m.*,c.name AS category_name FROM menu_items m JOIN categories c ON c.id=m.category_id`;
