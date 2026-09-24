# Project State Baseline

## Metadata
- target_project: `backend`
- baseline_mode: `mixed`
- status: `in_progress`
- created_at: `2026-08-05T00:00:00+07:00`
- updated_at: `2026-09-23T00:00:00+07:00`
- created_by: `claude`
- source_commit: `3d441ba (the 2026-09-23 LinkQu migration is NOT yet committed to this repo's own git history)`
- confidence: `high`

## Documentation Discovery
- locations_checked:
  - `sdlc_specification_document.pdf` (scaffold root, founder-supplied)
  - `dev-doc/topup-affiliate-platform/`
- relevant_documentation_found: `yes`
- documentation_used:
  - `dev-doc/topup-affiliate-platform/project-charter.md`
  - `dev-doc/topup-affiliate-platform/brd.md`
  - `dev-doc/topup-affiliate-platform/prd.md`
  - `dev-doc/topup-affiliate-platform/use-case.md`
  - `dev-doc/topup-affiliate-platform/userflow.md`
  - `dev-doc/topup-affiliate-platform/database-diagram.md`
- missing_or_stale_documentation: `none yet — this is a fresh greenfield baseline`
- founder_question_asked: `yes`
- founder_response: `Project slug confirmed (topup-affiliate-platform); database = PostgreSQL; commission_rate = 10%; minimum_withdrawal_amount = 100000; Provider Top-Up vendor unknown for now, use an internal mock/dummy service first; scope = backend only, frontend out of scope; founder already bootstrapped a NestJS project at development/backend.`

## Project Purpose And Boundary
- purpose: `Backend REST API for a game coin top-up platform with an affiliate/referral commission program, automated via LinkQu Payment Link (payment, migrated from Xendit then Duitku) and LinkQu Transfer Bank disbursement (commission payout).`
- supported_by:
  - `dev-doc/topup-affiliate-platform/brd.md`
  - `dev-doc/topup-affiliate-platform/prd.md`
- in_scope_systems:
  - `Customer top-up purchase API (check-id, checkout, Xendit callback, coin injection)` — implemented
  - `Affiliate registration, referral code, commission dashboard API` — implemented
  - `Superadmin approval, commission config, payout approval API` — implemented
  - `Commission audit ledger` — implemented (credit on referred purchase, debit on withdrawal lock, refund credit on failed payout)
- unknowns_or_assumptions:
  - `Real Provider Top-Up vendor: resolved 2026-08-26 — MomoLive, deployed and live`
  - `Frontend (Vue.js) explicitly out of scope for the current build phase`
  - `Payment gateway: Xendit (2026-08-05) -> Duitku (2026-08-25) -> LinkQu (2026-09-23, current). LinkQu's real endpoint contract, base URLs, and HMAC-SHA256 signature formula verified end-to-end against LinkQu's own dev sandbox before any code was written.`
  - `LinkQu Payment Link's real webhook callback shape is assumed to match the VA-specific "Callback Transaction Received" shape (the only one LinkQu's docs fully document) — not yet confirmed against a real Payment Link transaction.`

## Stack And Local Commands
| Area | Finding | Confidence | Evidence |
|---|---|---|---|
| Package manager | npm (package-lock.json present) | `high` | `development/backend/package-lock.json` |
| Runtime / version | Node.js (version not pinned in repo yet) | `medium` | `development/backend/package.json` engines not set |
| Frontend | none (out of scope per founder decision) | `high` | founder instruction 2026-08-05 |
| Backend / worker | NestJS 11 (`@nestjs/core` ^11.0.1, `@nestjs/platform-express`) | `high` | `development/backend/package.json` |
| Database / storage | PostgreSQL via TypeORM (`@nestjs/typeorm`, `typeorm`, `pg`); `synchronize: true` outside production (no migrations yet) | `high` | `development/backend/src/app.module.ts` |
| Test stack | Jest (unit) + Supertest (e2e), default Nest scaffold config | `high` | `development/backend/package.json` jest config, `test/` folder |
| Build command | `npm run build` (`nest build`) | `high` | `development/backend/package.json` |
| Run command | `npm run start:dev` (`nest start --watch`) | `high` | `development/backend/package.json` |

## System Map
- entrypoints:
  - `development/backend/src/main.ts` — Nest bootstrap, global prefix `api/v1`, global ValidationPipe, listens on `process.env.PORT ?? 3000`
- module_roots:
  - `development/backend/src/app.module.ts` — root module: ConfigModule, TypeOrmModule.forRootAsync, TopupModule, UsersModule, AuthModule, AffiliatesModule
  - `development/backend/src/topup/` — TopupController, XenditWebhookController, TopupService
  - `development/backend/src/products/`, `src/transactions/` — TypeORM entities + services
  - `development/backend/src/provider/` — ProviderTopUpPort + MockProviderTopUpService + MomoProviderTopUpService (real, selected via PROVIDER_TOP_UP_VENDOR=momo)
  - `development/backend/src/linkqu/` — LinkQuService (Payment Link creation, disbursement inquiry+payment, balance check, callback signature verification) — replaced src/duitku/ (Xendit->Duitku->LinkQu, see DECISION_LOG.md)
  - `development/backend/src/users/` — User entity + UsersService
  - `development/backend/src/auth/` — AuthService (JWT issue/refresh, bcrypt), JwtStrategy, JwtAuthGuard, RolesGuard/@Roles
  - `development/backend/src/affiliates/` — AffiliatorProfile, CommissionLog, CommissionWithdrawal entities; AffiliatesService (register, dashboard, approve/reject, commission rate, credit commission, request/approve withdrawal, disbursement callback); AffiliatesController; LinkQuDisbursementWebhookController
  - `development/backend/src/platform/` — PlatformService (platform revenue ledger + platform withdrawal lifecycle, mirrors AffiliatesService's withdrawal flow)
  - `development/backend/src/settings/` — PlatformSettings singleton entity + SettingsService (global commission rate, minimum withdrawal amount, admin payout bank details)
  - `development/backend/src/admin/` — AdminController (superadmin-only: affiliate approve/reject/commission-rate, settings, product CRUD, transaction monitoring, withdrawal approval, platform balance/withdrawal, provider/LinkQu balance monitoring)
- route_or_api_map:
  - `GET /api/v1/topup/products` (public, active only, no cost price exposed), `POST /api/v1/topup/check-id`, `POST /api/v1/topup/checkout`, `GET /api/v1/topup/transactions/:id` (public status check) — `development/backend/src/topup/topup.controller.ts`
  - `POST /api/v1/webhooks/linkqu/payment` — `development/backend/src/topup/webhook/linkqu-webhook.controller.ts`
  - `POST /api/v1/affiliate/register` (public), `GET /api/v1/affiliate/dashboard`, `PATCH /api/v1/affiliate/bank-details`, `POST /api/v1/affiliate/withdraw` (JWT + role `affiliator`) — `development/backend/src/affiliates/affiliates.controller.ts`
  - `POST /api/v1/webhooks/linkqu/disbursement` — `development/backend/src/affiliates/webhook/linkqu-disbursement-webhook.controller.ts`
  - `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh` — `development/backend/src/auth/auth.controller.ts`
  - `GET /api/v1/admin/affiliates` (filter by `?status=`), `POST .../approve`, `POST .../reject`, `PATCH .../commission-rate`, `GET|PATCH /api/v1/admin/settings`, `GET /api/v1/admin/products`, `POST /api/v1/admin/products`, `PATCH /api/v1/admin/products/:id`, `DELETE /api/v1/admin/products/:id`, `GET /api/v1/admin/withdrawals` (filter by `?status=`), `POST /api/v1/admin/withdrawals/:id/approve`, `POST .../reject`, `GET /api/v1/admin/transactions`, `GET /api/v1/admin/linkqu/balance`, `GET /api/v1/admin/provider/balance`, `POST /api/v1/admin/provider/coin-transfer`, `GET|POST /api/v1/admin/platform/balance|withdraw|withdrawals`, `POST /api/v1/admin/platform/withdrawals/:id/approve|reject`, `GET|POST/DELETE /api/v1/admin/contact-messages` — `development/backend/src/admin/admin.controller.ts` (JWT + role `superadmin`)
- data_and_integration_boundaries:
  - `PostgreSQL via TypeORM (Product, Transaction, User, AffiliatorProfile, CommissionLog, CommissionWithdrawal, PlatformSettings, PlatformWithdrawal, PlatformRevenueLog, ContactMessage entities), schema owned by real migrations (synchronize:false unconditionally)`
  - `LinkQu Payment Link API (LinkQuService.createInvoice, calling POST /member/payment-request/create)` — real-verified against LinkQu's own dev sandbox 2026-09-23 (not yet deployed/production-verified)`
  - `LinkQu Transfer Bank disbursement API (LinkQuService.createPayout, two-step inquiry+payment)` — real-verified end-to-end against LinkQu's own dev sandbox 2026-09-23, including a real completed payment step (not yet deployed/production-verified)`
  - `Provider Top-Up via ProviderTopUpPort (MomoProviderTopUpService real implementation, live on server; MockProviderTopUpService remains the default fallback)`
- auth_or_security_boundaries:
  - `LinkQu callback authenticity via HMAC-SHA256 signature verification (LinkQuService.verifyInvoiceCallbackSignature / verifyDisbursementCallbackSignature), used by both the payment and disbursement webhook controllers — formula taken from LinkQu's own docs, not yet independently confirmed against a real callback`
  - `JWT auth (access 15m / refresh 7d) via passport-jwt; bcrypt password hashing; RolesGuard + @Roles() for role-gated routes (affiliate dashboard/withdraw require role=affiliator AND user.status=active; all /admin/* routes require role=superadmin)`
  - `check-id/checkout remain intentionally unauthenticated per SRS-USR (public customer flow)`
  - `Commission balance mutations (credit, withdrawal lock, refund) use Postgres SELECT ... FOR UPDATE row locks via a manual TypeORM QueryRunner transaction`
- configuration_and_environment_requirements:
  - `DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_NAME, LINKQU_CLIENT_ID, LINKQU_CLIENT_SECRET, LINKQU_USERNAME, LINKQU_PIN, LINKQU_SIGNATURE_KEY, LINKQU_MODE, MOMO_MERCHANT_ID, MOMO_API_SECRET, MOMO_BASE_URL, PROVIDER_TOP_UP_VENDOR, JWT_SECRET, PORT, NODE_ENV — .env.example itself is blocked from being read/written by the harness's secret-file guard, so the LINKQU_* lines above still need to be added by the founder`
  - `Local Postgres: development/backend/docker-compose.yml (docker compose up -d)`

## Constraints And Known State
- known_failures_or_baseline_issues:
  - `none — build, lint (0 errors, 15 pre-existing-pattern warnings), unit tests (73/73), and e2e tests (66/66) all pass locally as of 2026-09-23 (LinkQu migration), against a real migrated Postgres (synchronize:false)`
- inherited_constraints_or_technical_debt:
  - `AffiliatorProfile.approvedBy is a plain bigint column, not a real FK relation to User (kept simple since it is write-only metadata, not queried via join)`
  - `LinkQu's Payment Link real webhook callback shape is assumed (not confirmed) to match the documented VA callback shape — see Constraints/Blockers in ACTIVE_CONTEXT.md`
  - `LINKQU_BANK_CODES is a static 12-bank table sourced from LinkQu's own docs, not a live lookup — an affiliate/platform bank outside this list gets a clean BANK_CODE_MISSING failure, not a crash, until extended`
  - `AffiliatorProfile.user relation must never be requested (via relations:{user:true}) together with a pessimistic lock in the same query — Postgres rejects FOR UPDATE across the resulting LEFT JOIN; the fix was removing eager:true and doing a separate unlocked User lookup wherever both are needed inside a locked transaction (see creditCommissionForTransaction, requestWithdrawal)`
- unknown_critical_areas:
  - `LinkQu migration (2026-09-23) is built and locally verified only — not yet deployed, not yet tested against a real production LinkQu account or a real callback`
  - `GET /topup/products/:id/payment-methods was removed with the LinkQu migration (no equivalent found) — impact on the FE not yet confirmed with the FE dev`

## Targeted Discovery Index
| Future Task Area | Start With | Adjacent Evidence | Notes |
|---|---|---|---|
| Top-up purchase flow | `dev-doc/topup-affiliate-platform/userflow.md` (Flow 1) | `dev-doc/topup-affiliate-platform/prd.md` API Contracts | Implemented; checkout now via LinkQu Payment Link (2026-09-23), real-verified against LinkQu's sandbox, not yet deployed |
| Affiliate registration & dashboard | `dev-doc/topup-affiliate-platform/use-case.md` (UC-02, UC-03) | `development/backend/src/affiliates/` | Implemented |
| Superadmin endpoints | `dev-doc/topup-affiliate-platform/use-case.md` (UC-06, UC-07, UC-09, UC-10) | `development/backend/src/admin/` | Implemented |
| Commission crediting on checkout | `dev-doc/topup-affiliate-platform/prd.md` SRS-SYS-03 | `development/backend/src/affiliates/affiliates.service.ts` (creditCommissionForTransaction) | Implemented |
| Commission withdrawal flow | `dev-doc/topup-affiliate-platform/userflow.md` (Flow 2) | `development/backend/src/affiliates/entities/commission-withdrawal.entity.ts` | Implemented; disbursement now via LinkQu Transfer Bank (2026-09-23), real-verified end-to-end against LinkQu's sandbox including a real completed payment step, not yet deployed |
| Frontend (Vue.js) | `dev-doc/topup-affiliate-platform/prd.md` | n/a | Not started — explicitly out of scope so far |

## Memory And Shared Context Sync
- shared_active_context_updated: `yes`
- contributor_log_entry: `development/backend/artifacts/shared/CONTRIBUTOR_LOG.md#20260805-0000-claude`
- activity_log_entry: `none — root AGENT_ACTIVITY_LOG.md entry pending`
- memory_ledger_entries:
  - `none yet`
- feature_registry_entries:
  - `none yet`
- memory_changelog_entry: `none yet`

## Refresh History
| Date | Change Trigger | Updated Areas | Evidence |
|---|---|---|---|
| `2026-08-05` | First intake of founder-bootstrapped NestJS project | Stack And Local Commands, System Map | `development/backend/package.json`, `development/backend/src/` |
| `2026-08-05` | Implemented first slice (customer top-up purchase flow) | Stack And Local Commands, System Map, Constraints And Known State | `development/backend/src/topup/`, `src/xendit/`, `src/provider/`, build/lint/test/e2e all pass |
| `2026-08-10` | Live-verified checkout against real Xendit test-mode API | Constraints And Known State | Real invoice created and persisted; secret key stored only in local .env |
| `2026-08-10` | Implemented second slice (affiliate registration & dashboard, JWT auth) | System Map, Constraints And Known State, Targeted Discovery Index | `development/backend/src/users/`, `src/auth/`, `src/affiliates/`, 26/26 unit + 11/11 e2e tests pass |
| `2026-08-10` | Implemented third-fifth slices (superadmin endpoints, commission crediting, Xendit Disbursement withdrawal) in one bundled session | System Map, Constraints And Known State, Targeted Discovery Index | `development/backend/src/admin/`, `src/settings/`, expanded `src/affiliates/`; 41/41 unit + 27/27 e2e tests pass; fixed a real FOR-UPDATE/eager-join Postgres bug found via e2e |
| `2026-08-10` | Added missing admin list endpoints (affiliates, withdrawals, products) found via API-completeness review against the PRD | System Map | `GET /admin/affiliates`, `GET /admin/withdrawals`, `GET /admin/products`; 41 unit + 30 e2e tests pass |
| `2026-08-10` | Added missing public customer endpoints found via a second API-completeness pass | System Map | `GET /topup/products` (public catalog, no cost price), `GET /topup/transactions/:id` (public status check); 41 unit + 32 e2e tests pass |
| `2026-09-23` | Migrated payment gateway from Duitku to LinkQu (full replace, client decision) — see `artifacts/architecture/DECISION_LOG.md` for full detail | System Map, route_or_api_map, data_and_integration_boundaries, auth_or_security_boundaries, Constraints And Known State, Targeted Discovery Index | `development/backend/src/linkqu/` (new, replaces `src/duitku/`), rewired `topup`/`affiliates`/`platform`/`admin`, new migration `1790160000000-RenameDuitkuColumnsToLinkQu`, build/lint/73 unit/66 e2e all pass locally against a real migrated Postgres; not yet deployed or committed |
