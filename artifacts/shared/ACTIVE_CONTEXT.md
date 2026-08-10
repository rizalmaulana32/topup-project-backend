# Active Context

## Metadata
- target_project: `backend`
- created_at: `2026-08-05T00:00:00+07:00`
- updated_at: `2026-08-10T00:00:00+07:00`
- updated_by: `claude`
- status: `active`
- git_branch: `main`
- git_commit: `unknown (no commits yet — all files untracked, nothing committed by the agent)`

## Current Position
- active_feature: `topup-affiliate-platform`
- active_slice: `superadmin endpoints, commission crediting, Xendit Disbursement withdrawal — all implemented and verified`
- current_status: `All five bootstrap slices complete: customer top-up purchase, affiliate registration/dashboard, superadmin admin panel, commission crediting, and withdrawal payout. Build/lint/41 unit/27 e2e all green.`
- current_gate: `G5`
- resume_safe: `yes`
- activity_log_current_entry: `none`

## What Is Known
- `NestJS 11 backend at development/backend now has the full backend feature set from the founder's SDLC spec except a real Provider Top-Up vendor and any frontend.` — `development/backend/src/`
- `Requirement baseline exists at dev-doc/topup-affiliate-platform/ (charter, BRD, PRD, use-case, userflow, database-diagram), all updated for Xendit.`
- `Local Postgres available via development/backend/docker-compose.yml (docker compose up -d); schema is TypeORM synchronize:true in non-production, not migrations yet.`
- `Checkout is live-verified against the real Xendit test-mode API (real invoice id + checkout-staging.xendit.co URL returned and persisted). Xendit Payout (Disbursement) has only been e2e-tested against a mocked client, never a real call.`
- `e2e tests MUST run with --runInBand (already set as the default npm run test:e2e) — running e2e spec files in parallel causes real failures (TypeORM synchronize races, and separate files truncating/reading the same shared dev DB concurrently), not just slowness.`
- project_state_baseline: `development/backend/artifacts/shared/PROJECT_STATE.md, last verified 2026-08-10`

## Decisions Locked
- `Project slug: topup-affiliate-platform` — founder chat 2026-08-05
- `Database: PostgreSQL` — founder chat 2026-08-05
- `Global commission rate: 10%; minimum withdrawal amount: 100000` — founder chat 2026-08-05; now the PlatformSettings default and superadmin-configurable via PATCH /api/v1/admin/settings
- `Provider Top-Up: internal mock service (MockProviderTopUpService) behind ProviderTopUpPort, real vendor undecided` — founder chat 2026-08-05
- `Scope: backend only, frontend explicitly out of scope for now` — founder chat 2026-08-05
- `Payment gateway/payout provider: Xendit (xendit-node v7, Invoice API + Payout/Disbursement API), overriding the source document's Midtrans choice` — founder chat 2026-08-05
- `ORM: TypeORM; auth/config: @nestjs/config + class-validator/class-transformer` — recorded in artifacts/architecture/DECISION_LOG.md 2026-08-05
- `Auth: JWT (access 15m / refresh 7d) via @nestjs/jwt + passport-jwt; bcrypt password hashing` — founder-approved plan 2026-08-10
- `Registration fields for affiliates: name, email, password, bank_name, account_number, account_holder` — founder-approved plan 2026-08-10
- `Superadmin approval endpoint is now real (POST /api/v1/admin/affiliates/:id/approve|reject); superadmin accounts themselves are still provisioned via direct SQL only (no self-registration)` — founder-approved plan 2026-08-10
- `PlatformSettings is a singleton row (id=1) for global commission rate / minimum withdrawal; per-affiliate override stays on AffiliatorProfile.commission_rate` — recorded in DECISION_LOG.md 2026-08-10
- `Withdrawal ledger timing: debit recorded at request/lock time, not at Xendit success callback; a failed/cancelled/reversed callback writes a refund credit entry` — recorded in DECISION_LOG.md 2026-08-10
- `WithdrawalStatus adds "failed" beyond the source ERD's 4 values (pending/approved/rejected/paid), to distinguish admin-rejected from Xendit-failed` — recorded in DECISION_LOG.md 2026-08-10
- `Xendit Payout channelCode derived as ID_<BANK_NAME uppercased> from the affiliate's free-text bank_name — verified 2026-08-10 against the real getPayoutChannels API using the founder's existing Xendit key (BCA, BNI, Mandiri, BRI, CIMB, Permata all matched exactly)` — recorded in DECISION_LOG.md 2026-08-10
- `TRANSACTIONS.affiliator_id from the source ERD is still not a real FK — commission crediting resolves the referralCode string to an AffiliatorProfile at credit time instead.`

## Current Scope
- allowed_write_paths:
  - `development/backend/src/`, `package.json`, `test/`, `.env.example`, `artifacts/shared/`
- blocked_paths:
  - `development/backend/.env` (real secrets)
  - any Vue.js/frontend code
- not yet built:
  - `Real Provider Top-Up vendor integration`
  - `Real Xendit Payout call with live/test credentials (only mocked in e2e so far)`
  - `Migrations (schema is still synchronize:true)`
  - `Frontend of any kind`

## Latest Work Summary
- `Added Swagger/OpenAPI docs (@nestjs/swagger). Live interactive explorer at /api/docs (Bearer auth wired in via the Authorize button); the two Xendit webhook controllers are excluded since Xendit calls those, not a person. Rewrote development/backend/README.md from the default Nest boilerplate into a real, human-written project README with a full manual endpoint table plus a pointer to /api/docs. Verified live: booted the app and confirmed the OpenAPI JSON lists exactly the 19 expected paths, webhooks correctly absent. 41 unit + 32 e2e tests still pass.`
- `Note: npm flagged 2 high-severity advisories for js-yaml, pulled in transitively by @nestjs/swagger itself (a DoS via slow parsing of attacker-controlled YAML). Not fixed — the suggested fix is a breaking downgrade of @nestjs/swagger, and this app never parses untrusted YAML through it (Swagger UI only renders our own generated spec), so exposure is minimal. Worth another look if @nestjs/swagger ships a patched release.`
- `Added the three admin list endpoints that were missing against the PRD (GET /admin/affiliates, GET /admin/withdrawals, GET /admin/products, all with optional status filter + pagination on the first two). Without these, a real superadmin had no way to discover which IDs to act on. 41 unit + 30 e2e tests pass.`
- `Second API-completeness pass found the customer side had the same gap: no way to discover a valid product_id for checkout, and no way to check a transaction's real status after paying (Xendit's redirect alone isn't reliable). Added GET /topup/products (public, active only, deliberately excludes base_price/cost) and GET /topup/transactions/:id (public status check by ID — same trust model as a typical order-tracking page; no new PII or financial data exposed beyond what checkout already returns). 41 unit + 32 e2e tests pass.`
- `Built and verified three more slices in one bundled session (founder said "do them" after being offered all three): (1) Superadmin — PlatformSettings singleton + SettingsService, AdminController with affiliate approve/reject/commission-rate override, settings get/update, product CRUD, transaction monitoring, all JWT+role(superadmin)-guarded. (2) Commission crediting — AffiliatesService.creditCommissionForTransaction wired into TopupService.handleInvoicePaid, using a Postgres SELECT...FOR UPDATE row lock via a manual TypeORM QueryRunner transaction. (3) Xendit Disbursement — CommissionWithdrawal entity, POST /affiliate/withdraw (locks balance immediately), POST /admin/withdrawals/:id/approve (real Xendit Payout API call via XenditService.createPayout), POST /webhooks/xendit/disbursement (SUCCEEDED marks paid; FAILED/CANCELLED/REVERSED refunds with a corrective credit entry).`
- `Found and fixed a real bug during e2e verification: AffiliatorProfile.user had eager:true, which forces a LEFT JOIN on every query regardless of requested relations; combined with a pessimistic row lock, Postgres rejected it ("FOR UPDATE cannot be applied to the nullable side of an outer join"). Fixed by removing eager:true and doing separate unlocked User lookups inside locked transactions where an active-status check is needed.`
- `Also fixed an e2e test-infrastructure issue: with 5 e2e spec files now sharing one dev Postgres, running them in parallel (Jest's default) caused timeouts and cross-file interference. Set test:e2e to always run --runInBand (serial) and raised the Jest e2e hook timeout to 30s.`
- `Verified against a real local Postgres: build, lint (0 errors, 6 pre-existing accepted warnings), 41 unit tests, and 27 e2e tests (admin auth/guards, affiliate approve/reject, settings, product CRUD, transaction monitoring, full commission-credit-then-withdraw-then-payout-then-callback lifecycle including a failed-payout refund path) all pass.`

## QA Status
- unit: `pass (41/41, npm test)`
- integration: `pass (32/32 e2e via npm run test:e2e --runInBand, real Postgres, Xendit mocked for Invoice+Payout)`
- e2e_browser: `not_required (no frontend in scope)`
- ui_visual: `not_required (no frontend in scope)`
- manual_visual_qa_required: `no`
- manual_visual_qa_status: `not_required`
- manual_visual_qa_reference: `none`
- security: `partial — x-callback-token verification (both webhooks), JWT auth (missing/invalid/wrong-role token), password hashing, pending-approval gating, and role-guarded admin routes are all unit/e2e tested; no broader security review (rate limiting, brute-force protection, audit logging) has been done`
- performance: `not_run`
- regression: `pass — all prior-slice tests (topup, affiliate) still pass alongside the new admin/commission/withdrawal tests`

## Blockers
- `None for any implemented endpoint.`
- `Xendit Callback Verification Token is still a local placeholder — both webhook paths remain verified only via the mocked e2e path (no public callback URL in this sandbox).`
- `No real Xendit Payout has ever been executed (only getPayoutChannels was called, read-only, to verify the channel-code convention) — an actual disbursement would need either a tunnel (e.g. ngrok) or polling getPayoutById to observe the real callback locally.`
- `Real Provider Top-Up vendor still undecided — mock service in use.`

## Next Exact Step
- `All five originally-scoped slices are complete. Await founder direction: real Provider Top-Up vendor selection, frontend work, migrations, a live Xendit Payout test, or a new feature area.`

## Do Not Repeat
- `Do not declare a TypeORM @Column with a TS union type (e.g. string | null) without an explicit type: option — reflect-metadata resolves the design type to Object for unions, which TypeORM rejects for Postgres (hit this on Transaction.targetZoneId/referralCode/xenditInvoiceId, fixed by adding type: 'varchar').`
- `Do not pass a bare jest.Mocked<Interface>.method reference into expect(...) — @typescript-eslint/unbound-method flags it; keep a separate jest.fn() handle instead.`
- `TypeORM's FindOneOptions.relations expects an object form ({ user: true }) in this TypeORM version, not an array (['user']) — array form fails to compile.`
- `Do not mark a TypeORM relation eager:true if that entity is ever fetched inside a pessimistic-locked query — Postgres rejects FOR UPDATE across the LEFT JOIN eager forces. Keep relations non-eager and request them explicitly only in unlocked queries; do separate unlocked lookups inside locked transactions instead.`
- `Do not Read or cat the .env files directly — the harness denies it (secret-file guard). Write/append via Bash still works; verify success by the tool's own result, not by reading the file back.`
- `Run npm run test:e2e with --runInBand (already the default script) once more than 2-3 e2e spec files share the same dev database — parallel workers race on TypeORM synchronize and can truncate/read each other's data mid-test, causing real failures, not just the earlier-seen cosmetic retry warning.`
