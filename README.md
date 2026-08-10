# Topup & Affiliate Platform — Backend

A REST API for a game coin top-up service with a built-in affiliate program. Customers buy coin packages and pay through Xendit, affiliates earn commission on purchases made through their referral link, and superadmins run approvals, commission rules, and payouts.

Built with NestJS, PostgreSQL (via TypeORM), and Xendit for payments and payouts. No frontend here — this is the API only.

## Stack

- NestJS 11 + TypeScript
- PostgreSQL + TypeORM
- Xendit (Invoice API for payments, Payout API for affiliate withdrawals)
- JWT auth (access + refresh tokens) with bcrypt password hashing
- Jest for unit + e2e tests

## Getting started

```bash
npm install

# start a local Postgres (docker-compose.yml is already set up)
docker compose up -d

# copy the example env and fill in real values
cp .env.example .env

npm run start:dev
```

The app boots on `http://localhost:3000` with everything under the `/api/v1` prefix.

Once it's running, there's also a live interactive API explorer at **`http://localhost:3000/api/docs`** — same endpoints as the reference below, but you can actually try requests from the browser (there's an "Authorize" button for pasting a JWT once you've logged in).

### Environment variables

| Variable | What it's for |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` | Postgres connection |
| `XENDIT_SECRET_KEY` | Your Xendit secret key (test mode while developing) |
| `XENDIT_CALLBACK_TOKEN` | The verification token Xendit shows you under Settings → Developers → Callbacks. We check every incoming webhook against this. |
| `JWT_SECRET` | Signs access/refresh tokens |
| `PORT`, `NODE_ENV` | Standard stuff |

`.env` is gitignored — never commit real keys.

### Database

Schema is created automatically on boot (`synchronize: true`) since this is still early/local development. That's fine for now, but before this touches a shared or production database it needs to switch to real migrations instead.

## Testing

```bash
npm test          # unit tests
npm run test:e2e  # e2e tests against a real local Postgres — always runs serially (--runInBand)
```

The e2e suite spins up the real app against Docker Postgres and hits actual HTTP endpoints, so make sure `docker compose up -d` is running first.

## API Reference

Everything below is prefixed with `/api/v1`. Auth-protected routes need `Authorization: Bearer <access_token>`. Prefer clicking through it instead? Run the app and open `/api/docs`.

### Customer / top-up (public, no login needed)

| Method | Path | What it does |
|---|---|---|
| `GET` | `/topup/products` | List active coin packages a customer can buy |
| `POST` | `/topup/check-id` | Validate a game/user ID before checkout. Body: `{ game_code, user_id, zone_id? }` |
| `POST` | `/topup/checkout` | Start a purchase. Body: `{ product_id, target_user_id, target_zone_id?, affiliate_code? }`. Returns a Xendit invoice URL to pay. |
| `GET` | `/topup/transactions/:id` | Check a transaction's status (useful after redirecting back from Xendit) |

### Auth

| Method | Path | What it does |
|---|---|---|
| `POST` | `/auth/login` | Body: `{ email, password }`. Returns access + refresh tokens. |
| `POST` | `/auth/refresh` | Body: `{ refresh_token }`. Returns a fresh access token. |

### Affiliate

| Method | Path | Auth | What it does |
|---|---|---|---|
| `POST` | `/affiliate/register` | none | Sign up as an affiliate. Body: `{ name, email, password, bank_name, account_number, account_holder }`. Status starts as `pending_approval` until a superadmin approves it. |
| `GET` | `/affiliate/dashboard` | affiliate | Referral stats, commission balance, and commission history |
| `POST` | `/affiliate/withdraw` | affiliate | Request a payout. Body: `{ amount }`. Only works once balance ≥ the minimum withdrawal amount. |

### Superadmin

Everything here needs a superadmin JWT. There's no self-registration for admins — those accounts get created directly in the database.

| Method | Path | What it does |
|---|---|---|
| `GET` | `/admin/affiliates` | List affiliate registrations. Filter with `?status=pending_approval\|active\|inactive`, paginate with `?limit=&offset=` |
| `POST` | `/admin/affiliates/:id/approve` | Approve an affiliate — activates them and generates their referral code |
| `POST` | `/admin/affiliates/:id/reject` | Reject an affiliate |
| `PATCH` | `/admin/affiliates/:id/commission-rate` | Override one affiliate's commission rate. Body: `{ commission_rate }` |
| `GET` | `/admin/settings` | View global commission rate + minimum withdrawal amount |
| `PATCH` | `/admin/settings` | Update them. Body: `{ global_commission_rate?, minimum_withdrawal_amount? }` |
| `GET` | `/admin/products` | List the full product catalog |
| `POST` | `/admin/products` | Add a product. Body: `{ name, provider_code, base_price, selling_price }` |
| `PATCH` | `/admin/products/:id` | Edit a product (price, name, status, etc.) |
| `GET` | `/admin/withdrawals` | List withdrawal requests. Filter with `?status=pending\|approved\|paid\|failed` |
| `POST` | `/admin/withdrawals/:id/approve` | Approve a withdrawal — this triggers a real Xendit Payout call |
| `GET` | `/admin/transactions` | Monitor all transactions, paginated |

### Webhooks (Xendit calls these — you don't)

| Method | Path | What it does |
|---|---|---|
| `POST` | `/webhooks/xendit/invoice` | Xendit tells us a payment settled here. Triggers coin injection + commission credit. |
| `POST` | `/webhooks/xendit/disbursement` | Xendit tells us a payout succeeded or failed here. Updates the withdrawal and refunds the balance on failure. |

Both check the `x-callback-token` header against `XENDIT_CALLBACK_TOKEN` and reject anything that doesn't match.

## What's still not real

Worth knowing before you assume everything's production-ready:

- **Provider Top-Up (the actual game coin delivery) is mocked.** `check-id` returns a fake username, `injectCoin` always "succeeds." No real vendor picked yet — swap it out by implementing `ProviderTopUpPort` once you have one.
- **Xendit payment/payout creation is real and verified**, but the webhook callbacks have only been simulated in tests — nobody's actually paid a real invoice or received a real payout callback yet, because this local setup has no public URL for Xendit to call back to. A tunnel (ngrok or similar) would fix that for testing.
- **No migrations yet** — schema auto-syncs, which is fine solo but not once this is shared or deployed.
- **No frontend.** This is API-only by design for now.
