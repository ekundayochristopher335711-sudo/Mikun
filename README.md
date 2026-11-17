# Mikun restaurant website

A responsive restaurant website and restaurant management platform for **MIKUN GOOD FOOD GOOD VIBE**. The 22 menu items and prices were transcribed from the supplied menu photograph. The UI uses real licensed food photography as illustrative cuisine imagery; source and license links are listed in \`public/photos/SOURCES.md\`.

## Run locally

\`\`\`bash
npm install
npm run dev
\`\`\`

Open the URL shown by Vite for the public site. Use \`/admin\` for staff access, \`/account\` for customer accounts, and \`/track\` for guest order tracking.

## Included experiences

- Public site with searchable categories, favourites, item options, persistent basket, guest checkout, reservations, gallery, approved reviews, theme toggle, and responsive layouts.
- Customer accounts with sign-in, order history, reservation history, profile editing, and completed-order reviews.
- Staff admin with protected login, dashboard, menu/category CRUD, photo uploads, order and payment status, reservations/tables, reviews, promotions, staff roles, CMS settings, and audit logs.
- Persistent SQLite storage, server-side price calculation, CSRF/origin protections, rate limits, role-based access, guest order tracking tokens, and reservation conflict prevention.

## Configure before launch

The API intentionally keeps online payment disabled until a verified provider and webhook flow are configured. Delivery and reservations remain disabled until the restaurant configures them in admin. Add the verified address, phone, hours, social links, approved Mikun photography, and payment credentials before accepting live orders.

Create the first staff owner locally with \`OWNER_NAME\`, \`OWNER_EMAIL\`, and a strong \`OWNER_PASSWORD\`, then run \`npm run setup:owner\`. See \`server/README.md\` for API routes, environment variables, roles, and deployment notes.
