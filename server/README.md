# Mikun restaurant API

This is a persistent local API for the Mikun website. It uses Express, SQLite, Zod, and bcrypt. The first launch creates `server/data/mikun.sqlite` and seeds the 22 items and prices from the supplied menu photograph. Menu data is thereafter managed in SQLite. Contact details and images start blank because no verified business details or food photos were supplied for those records.

## Run locally

Install root dependencies: `express`, `better-sqlite3`, `zod` (v4), and `bcryptjs`. Use Node 20 or later. Start with `node server/index.js`; the default port is `3001`. Build the Vite frontend first (`npm run build`) to serve the complete site from this same process. In development, proxy `/api` from Vite to `http://localhost:3001`.

Environment variables:

| Name | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP listen port | `3001` |
| `DATABASE_PATH` | Persistent SQLite file | `server/data/mikun.sqlite` |
| `MEDIA_DIR` | Uploaded image directory | `server/data/media` |
| `APP_ORIGIN` | Exact browser origin allowed for cross-origin-sensitive writes; set to the frontend origin if separate in development | Request origin inferred from host |
| `NODE_ENV` | Set to `production` behind HTTPS for Secure session cookies | Development |
| `OWNER_NAME`, `OWNER_EMAIL`, `OWNER_PASSWORD` | Used only by the one-time owner setup command | None |

Before accessing the admin area, set `OWNER_NAME`, `OWNER_EMAIL`, and a strong `OWNER_PASSWORD` (at least 12 characters) in your local shell and run `node server/create-owner.js`. The command refuses to replace an existing owner. Do not commit credentials or put them in frontend environment variables. Staff accounts can subsequently be created by the owner in the admin API.

Keep the database and media directory on persistent storage, and back up both. SQLite runs in WAL mode, uses foreign keys, and has a 5-second busy timeout. A single Node process is the intended deployment for this local SQLite version.

## Authentication and writes

`POST /api/auth/register` takes `{name,email,phone?,password}` and `POST /api/auth/login` takes `{email,password}`. They return `{user,csrfToken}` and set an HttpOnly, SameSite session cookie. `GET /api/auth/session` refreshes the current user and CSRF token. Send `X-CSRF-Token` for every authenticated `POST`, `PATCH`, or `DELETE`, including admin writes. `POST /api/auth/logout` ends the session. Session tokens are random and only SHA-256 hashes are stored. Origin and Fetch Metadata checks block cross-site writes. Sessions expire after seven days.

Roles: `customer`, `owner`, `administrator`, `manager`, `cashier`, `kitchen`, `delivery`. Admin routes require an appropriate staff role. Only the owner can create or disable staff and inspect audit logs.

## Public and customer routes

| Method/path | Purpose |
| --- | --- |
| `GET /api/public/menu` | Available categories and all menu items; optional `category`, `q`, `popular=true` |
| `GET /api/public/settings` | Business settings and site content |
| `GET /api/public/reviews` | Approved reviews only |
| `POST /api/orders` | Create a guest or signed-in order; returns `{order,trackingToken}` |
| `GET /api/orders/:id` | Track with `X-Order-Token`, an owning account, or staff role |
| `GET /api/reservations/availability?date=YYYY-MM-DD&partySize=2` | Available slots |
| `POST /api/reservations` | Book an available table; returns `{reservation,trackingToken}` |
| `GET /api/reservations/:id` | Track with `X-Reservation-Token`, an owning account, or staff role |
| `POST /api/reviews` | Submit a pending review for a completed account order |
| `GET/PATCH /api/account/profile` | View or edit signed-in profile |
| `GET /api/account/orders` | Signed-in order history |
| `GET /api/account/reservations` | Signed-in reservation history |
| `POST /api/payments/initialize` | Always returns `503 PAYMENTS_NOT_CONFIGURED` |

`POST /api/orders` accepts `{customerName,phone,email?,fulfilment:'pickup'|'delivery',deliveryAddress?,instructions?,paymentMethod:'pay_on_pickup'|'pay_on_delivery',promotionCode?,items:[{menuItemId,quantity,options?:[{groupId,choiceId}]}]}`. For the current UI it also accepts `fulfillment`, `address`, `notes`, and item `id` as aliases. Prices, option costs, discounts, delivery fee, and total are calculated from SQLite in a transaction; client totals are never trusted. Delivery is disabled in settings until the restaurant enables it and sets a fee. Only matching pay-on-pickup or pay-on-delivery methods are accepted.

`POST /api/reservations` accepts `{customerName,phone,email?,date,time,partySize,requests?}` and also accepts `name`, `guests`, and `notes` aliases. Reservations are disabled until an admin creates at least one active table and opens reservations. A unique database index prevents two active reservations from claiming the same table/date/time, including concurrent requests. Booking returns `409 SLOT_UNAVAILABLE` if a slot fills.

`POST /api/reviews` accepts `{orderId?,rating,body}`. The current UI's `comment` alias is accepted; if `orderId` is omitted, the most recent completed, unreviewed order belonging to that account is used. A completed account order is required. Reviews remain `Pending` until a manager approves them.

## Admin routes

All paths below begin with `/api/admin` and return JSON.

| Area | Routes |
| --- | --- |
| Overview | `GET /dashboard` provides daily order counts, paid completed revenue, pending reservations/reviews, unavailable menu count, latest orders |
| Menu | `GET/POST /categories`, `PATCH/DELETE /categories/:id`; `GET/POST /menu`, `PATCH/DELETE /menu/:id` |
| Orders | `GET /orders?status=&q=&limit=&offset=`, `GET /orders/:id`, `PATCH /orders/:id/status`, `PATCH /orders/:id/payment` |
| Tables/reservations | `GET/POST /tables`, `PATCH/DELETE /tables/:id`; `GET /reservations?date=&status=`, `PATCH /reservations/:id/status` |
| Reviews | `GET /reviews?status=`, `PATCH /reviews/:id` with `Approved` or `Hidden` |
| Site | `GET /settings`, `PATCH /settings`, `PATCH /content` with partial objects |
| Promotions | `GET/POST /promotions`, `PATCH/DELETE /promotions/:id` |
| Staff and audit | `GET/POST /staff`, `PATCH /staff/:id`, `GET /audit?limit=&offset=` (owner only) |
| Images | `POST /media` with raw JPEG/PNG/WebP bytes, matching `Content-Type`, maximum 5 MB; returns `{url}`; images served by `GET /api/media/:filename` |

Order status changes follow `Received → Confirmed → Preparing → Ready → Out for Delivery → Completed` for delivery and `Received → Confirmed → Preparing → Ready → Completed` for pickup, with explicit reject/cancel transitions. Status changes and cash payment recordings create audit entries. Cash payments can be marked paid by authorized staff; online payments cannot be marked paid manually.

Online payment, payment webhooks, automated SMS/email/WhatsApp notifications, delivery assignment, and background jobs are intentionally unavailable until real providers and verification are configured. The API never reports a successful online payment without a verified provider callback. The admin UI should surface these states clearly.
