# Topup & Affiliate Platform — Backend

A REST API for a game coin top-up service with a built-in affiliate program. Customers buy coin packages and pay through Duitku, affiliates earn commission on purchases made through their referral link, and superadmins run approvals, commission rules, and payouts.

Built with NestJS, PostgreSQL (via TypeORM), and Duitku for payments and payouts. No frontend here — this is the API only.

## Stack

- NestJS 11 + TypeScript
- PostgreSQL + TypeORM
- Duitku (Pop/createInvoice for payments, Disbursement/Transfer Online for affiliate withdrawals)
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
| `DUITKU_MERCHANT_CODE`, `DUITKU_API_KEY` | Your Duitku merchant credentials |
| `DUITKU_ENV` | `sandbox` (default) or `production` — picks which Duitku base URL to call |
| `DUITKU_CALLBACK_URL`, `DUITKU_RETURN_URL` | Sent with every invoice creation request — where Duitku posts the payment callback, and where the customer is redirected after paying |
| `PROVIDER_TOP_UP_VENDOR` | `mock` (default) or `momo` — picks which `ProviderTopUpPort` implementation actually delivers coins |
| `MOMO_MERCHANT_ID`, `MOMO_API_SECRET` | Your MomoLive Coin Merchant credentials — only read when `PROVIDER_TOP_UP_VENDOR=momo` |
| `MOMO_BASE_URL` | MomoLive API base URL — defaults to the sandbox (`https://proxytest.momoindo.com`) |
| `JWT_SECRET` | Signs access/refresh tokens |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Optional — sends a notification email on every contact form submission. If left unset, submissions are still stored, just no email goes out (logged instead). |
| `SUPPORT_NOTIFICATION_EMAIL` | Optional — where contact form notifications are sent. No address, no email (submissions are still stored either way). |
| `PORT`, `NODE_ENV` | Standard stuff |

`.env` is gitignored — never commit real keys.

### Database

Schema is managed with real TypeORM migrations (`src/migrations/`, `src/data-source.ts`) — `synchronize` is off everywhere. After `docker compose up -d`, run:

```bash
npm run build
npm run migration:run
```

To make a schema change: edit an entity, then `npm run migration:generate -- src/migrations/YourMigrationName` (needs a running DB to diff against), review the generated file, and run `migration:run` again.

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
| `POST` | `/topup/checkout` | Start a purchase. Body: `{ product_id, target_user_id, target_zone_id?, affiliate_code? }`. Returns a Duitku invoice URL to pay. |
| `GET` | `/topup/transactions/:id` | Check a transaction's status (useful after redirecting back from Duitku) |

### Contact (public, no login needed)

| Method | Path | What it does |
|---|---|---|
| `POST` | `/contact` | Submit a support/partnership message. Body: `{ name, email, message }`. Always stored; also emails `SUPPORT_NOTIFICATION_EMAIL` if SMTP is configured. |

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
| `POST` | `/admin/products` | Add a product. Body: `{ name, provider_code, base_price, selling_price, coin_amount, bonus_coin?, flag? }` |
| `PATCH` | `/admin/products/:id` | Edit a product (price, coin amount, bonus, flag, status, etc.) |
| `DELETE` | `/admin/products/:id` | Soft-delete a product — hidden from every listing, row stays in the database so past transactions still resolve |
| `GET` | `/admin/withdrawals` | List withdrawal requests. Filter with `?status=pending\|approved\|rejected\|paid\|failed` |
| `POST` | `/admin/withdrawals/:id/approve` | Approve a withdrawal — this triggers a real Duitku disbursement call |
| `POST` | `/admin/withdrawals/:id/reject` | Decline a withdrawal before it's sent to Duitku (bad bank details, fraud, etc.) — refunds the locked balance |
| `GET` | `/admin/transactions` | Monitor all transactions, paginated |
| `GET` | `/admin/contact-messages` | List contact form submissions. Filter with `?status=open\|resolved` |
| `POST` | `/admin/contact-messages/:id/resolve` | Mark a submission resolved |
| `DELETE` | `/admin/contact-messages/:id` | Soft-delete a submission — hidden from listings, row stays in the database |

### Webhooks (Duitku calls these — you don't)

| Method | Path | What it does |
|---|---|---|
| `POST` | `/webhooks/duitku/invoice` | Duitku tells us how a payment went. `resultCode: "00"` triggers coin injection + commission credit; anything else marks it failed. |
| `POST` | `/webhooks/duitku/disbursement` | Duitku tells us a payout succeeded or failed here. Updates the withdrawal and refunds the balance on failure. |

Both are form-urlencoded (not JSON) and carry their own `signature` field — an HMAC/SHA-256 hash computed from the merchant code, amount, and order/reference ID using `DUITKU_API_KEY`. Anything with a missing or wrong signature gets rejected.

## What's still not real

Worth knowing before you assume everything's production-ready:

- **Provider Top-Up (the actual game coin delivery) has a real implementation now, but mock stays the default.** `MomoProviderTopUpService` (MomoLive Coin Merchant API — `query-user`, `balance`, `transfer-coin`) is real-verified against the sandbox with real test credentials; set `PROVIDER_TOP_UP_VENDOR=momo` to use it. Until that's set, `check-id` returns a fake username and `injectCoin` always "succeeds" via the mock — nothing deployed does real coin transfers yet.
- **Duitku payment collection (`createInvoice`) is real and verified** — tested directly against the real sandbox API with the client's actual credentials, first try, exact match on every field.
- **Duitku disbursement (affiliate payouts) is not usable yet.** The account's disbursement feature isn't provisioned — real test calls to both the inquiry and transfer endpoints return the same generic rejection regardless of input, even with a deliberately wrong signature. Real testing also revealed the flow needs two separate calls (inquiry, then transfer using its result) with distinct signature formulas, plus a merchant `userId`/`email` the client hasn't located in their dashboard yet. `DuitkuService.createPayout` implements the two-call flow but none of it can be confirmed correct until disbursement is actually activated.
- **Duitku's invoice callback has no explicit "expired" signal** the way Xendit's did — it only fires for a definitive success/failure result. A transaction that's never paid within its window just stays `pending` unless something else (e.g. a scheduled job polling Duitku's transaction-status endpoint) is added later; `TopupService.handleInvoiceExpired` still exists and is tested for that future use, it's just not wired to anything yet.
- **Duitku's Transfer Online disbursement product has no callback at all** — unlike Xendit's Payout, the transfer call's response *is* the final result, so `AffiliatesService.approveWithdrawal` resolves synchronously. The old callback path (`handleDisbursementCallback`, `/webhooks/duitku/disbursement`) is kept for Duitku's separate "Clearing" product, which does have one, in case this app ever needs it.
- **Duitku disbursement needs a real bank-code mapping before it can work at all.** Unlike Xendit's derivable `ID_<BANK_NAME>` convention, Duitku uses its own bank code list; `DuitkuService` deliberately throws a clear error instead of guessing at one — this needs to be sourced from Duitku's real bank list once an account exists.
- **No frontend.** This is API-only by design for now.
