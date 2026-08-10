# Project State Baseline

## Metadata
- target_project: `backend`
- baseline_mode: `mixed`
- status: `in_progress`
- created_at: `2026-08-05T00:00:00+07:00`
- updated_at: `2026-08-05T00:00:00+07:00`
- created_by: `claude`
- source_commit: `unknown (git repo initialized, no commits yet)`
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
- purpose: `Backend REST API for a game coin top-up platform with an affiliate/referral commission program, automated via Xendit Invoice (payment) and Xendit Disbursement (commission payout).`
- supported_by:
  - `dev-doc/topup-affiliate-platform/brd.md`
  - `dev-doc/topup-affiliate-platform/prd.md`
- in_scope_systems:
  - `Customer top-up purchase API (check-id, checkout, Xendit callback, coin injection)` — implemented
  - `Affiliate registration, referral code, commission dashboard API` — implemented
  - `Superadmin approval, commission config, payout approval API` — implemented
  - `Commission audit ledger` — implemented (credit on referred purchase, debit on withdrawal lock, refund credit on failed payout)
- unknowns_or_assumptions:
  - `Real Provider Top-Up vendor not yet selected — mock service assumed for now`
  - `Frontend (Vue.js) explicitly out of scope for the current build phase`
  - `Xendit Payout channelCode convention (ID_<BANK_NAME>) verified 2026-08-10 against the real getPayoutChannels API (BCA, BNI, Mandiri, BRI, CIMB, Permata all matched exactly) — no longer an assumption`

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
  - `development/backend/src/provider/` — ProviderTopUpPort + MockProviderTopUpService
  - `development/backend/src/xendit/` — XenditService (Invoice creation, callback-token verification)
  - `development/backend/src/users/` — User entity + UsersService
  - `development/backend/src/auth/` — AuthService (JWT issue/refresh, bcrypt), JwtStrategy, JwtAuthGuard, RolesGuard/@Roles
  - `development/backend/src/affiliates/` — AffiliatorProfile, CommissionLog, CommissionWithdrawal entities; AffiliatesService (register, dashboard, approve/reject, commission rate, credit commission, request/approve withdrawal, disbursement callback); AffiliatesController; XenditDisbursementWebhookController
  - `development/backend/src/settings/` — PlatformSettings singleton entity + SettingsService (global commission rate, minimum withdrawal amount)
  - `development/backend/src/admin/` — AdminController (superadmin-only: affiliate approve/reject/commission-rate, settings, product CRUD, transaction monitoring, withdrawal approval)
- route_or_api_map:
  - `GET /api/v1/topup/products` (public, active only, no cost price exposed), `POST /api/v1/topup/check-id`, `POST /api/v1/topup/checkout`, `GET /api/v1/topup/transactions/:id` (public status check) — `development/backend/src/topup/topup.controller.ts`
  - `POST /api/v1/webhooks/xendit/invoice` — `development/backend/src/topup/webhook/xendit-webhook.controller.ts`
  - `POST /api/v1/affiliate/register` (public), `GET /api/v1/affiliate/dashboard`, `POST /api/v1/affiliate/withdraw` (JWT + role `affiliator`) — `development/backend/src/affiliates/affiliates.controller.ts`
  - `POST /api/v1/webhooks/xendit/disbursement` — `development/backend/src/affiliates/webhook/xendit-disbursement-webhook.controller.ts`
  - `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh` — `development/backend/src/auth/auth.controller.ts`
  - `GET /api/v1/admin/affiliates` (filter by `?status=`), `POST .../approve`, `POST .../reject`, `PATCH .../commission-rate`, `GET|PATCH /api/v1/admin/settings`, `GET /api/v1/admin/products`, `POST /api/v1/admin/products`, `PATCH /api/v1/admin/products/:id`, `GET /api/v1/admin/withdrawals` (filter by `?status=`), `POST /api/v1/admin/withdrawals/:id/approve`, `GET /api/v1/admin/transactions` — `development/backend/src/admin/admin.controller.ts` (JWT + role `superadmin`)
- data_and_integration_boundaries:
  - `PostgreSQL via TypeORM (Product, Transaction, User, AffiliatorProfile, CommissionLog, CommissionWithdrawal, PlatformSettings entities)`
  - `Xendit Invoice API via xendit-node (XenditService.createInvoice)` — live-verified against Xendit's real test-mode API 2026-08-10
  - `Xendit Payout (Disbursement) API via xendit-node (XenditService.createPayout)` — e2e-verified with a mocked Xendit client only (no real payout attempted)
  - `Provider Top-Up via ProviderTopUpPort (mock implementation only)`
- auth_or_security_boundaries:
  - `Xendit callback authenticity via x-callback-token constant-time comparison (XenditService.verifyCallbackToken), used by both the invoice and disbursement webhook controllers`
  - `JWT auth (access 15m / refresh 7d) via passport-jwt; bcrypt password hashing; RolesGuard + @Roles() for role-gated routes (affiliate dashboard/withdraw require role=affiliator AND user.status=active; all /admin/* routes require role=superadmin)`
  - `check-id/checkout remain intentionally unauthenticated per SRS-USR (public customer flow)`
  - `Commission balance mutations (credit, withdrawal lock, refund) use Postgres SELECT ... FOR UPDATE row locks via a manual TypeORM QueryRunner transaction`
- configuration_and_environment_requirements:
  - `DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_NAME, XENDIT_SECRET_KEY, XENDIT_CALLBACK_TOKEN, JWT_SECRET, PORT, NODE_ENV — see development/backend/.env.example`
  - `Local Postgres: development/backend/docker-compose.yml (docker compose up -d)`

## Constraints And Known State
- known_failures_or_baseline_issues:
  - `none — build, lint (0 errors), unit tests (41/41), and e2e tests (27/27) all pass as of 2026-08-10`
- inherited_constraints_or_technical_debt:
  - `TypeORM synchronize:true is used for schema in non-production; replace with migrations before any shared/staging/production database is used`
  - `AffiliatorProfile.approvedBy is a plain bigint column, not a real FK relation to User (kept simple since it is write-only metadata, not queried via join)`
  - `Xendit Payout channelCode is derived by convention (ID_<BANK_NAME uppercased>) rather than validated against Xendit's real channel list — confirm before any real (non-test-mode) payout`
  - `AffiliatorProfile.user relation must never be requested (via relations:{user:true}) together with a pessimistic lock in the same query — Postgres rejects FOR UPDATE across the resulting LEFT JOIN; the fix was removing eager:true and doing a separate unlocked User lookup wherever both are needed inside a locked transaction (see creditCommissionForTransaction, requestWithdrawal)`
- unknown_critical_areas:
  - `Real Provider Top-Up vendor not chosen — mock service only`
  - `Xendit Callback Verification Token is still a local placeholder — both the invoice and disbursement webhook paths are verified only via the mocked e2e path (no public callback URL in this sandbox)`
  - `No real Xendit Payout has been executed (createPayout is e2e-tested against a mocked Xendit client only); the channel-code convention IS verified against the live getPayoutChannels API (2026-08-10, read-only call), so the remaining gap is only the actual disbursement + callback, not the request shape`

## Targeted Discovery Index
| Future Task Area | Start With | Adjacent Evidence | Notes |
|---|---|---|---|
| Top-up purchase flow | `dev-doc/topup-affiliate-platform/userflow.md` (Flow 1) | `dev-doc/topup-affiliate-platform/prd.md` API Contracts | Implemented; checkout live-verified against real Xendit |
| Affiliate registration & dashboard | `dev-doc/topup-affiliate-platform/use-case.md` (UC-02, UC-03) | `development/backend/src/affiliates/` | Implemented |
| Superadmin endpoints | `dev-doc/topup-affiliate-platform/use-case.md` (UC-06, UC-07, UC-09, UC-10) | `development/backend/src/admin/` | Implemented |
| Commission crediting on checkout | `dev-doc/topup-affiliate-platform/prd.md` SRS-SYS-03 | `development/backend/src/affiliates/affiliates.service.ts` (creditCommissionForTransaction) | Implemented |
| Commission withdrawal flow | `dev-doc/topup-affiliate-platform/userflow.md` (Flow 2) | `development/backend/src/affiliates/entities/commission-withdrawal.entity.ts` | Implemented; real Xendit Payout call not yet attempted with live credentials |
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
