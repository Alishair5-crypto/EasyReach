# EasyReach Constitution Audit — 2026-10-10

**Status: ACTIVE / NOT SIGNED OFF.** This is the first evidence-backed audit pass, not a claim that every defect in the product has been found. Production has not been merged or deployed by this work. Database hardening below is staged as a migration on `test/security-regression-suite`; it has **not** been applied to the live Supabase database.

## Constitution gates

Workflow: INSPECT → AUDIT → PLAN → IMPLEMENT → BUILD → TEST → SECURITY AUDIT → VERIFY → SIGN OFF.

Non-negotiables checked: no fake integration state; server-derived tenant; RLS plus authorization; verified order/inventory data; webhook signatures and idempotency; secrets server-only; no production promotion before all gates pass.

## Findings and disposition

| ID | Severity | Finding / evidence | Disposition |
|---|---|---|---|
| ER-001 | **Critical** | Live DB grants allowed direct authenticated INSERT/UPDATE/DELETE on `orders` and `order_items`; the tenant-member RLS policy is `ALL`. That can bypass the lifecycle RPC, inventory logic, idempotency and audit events. | **Fix staged** in `20261010090000_harden_order_confirmation_mutations.sql`: revoke direct DML; mutation RPCs become SECURITY DEFINER with role checks. Must test on an isolated DB before production. |
| ER-002 | **Critical** | Live DB grants and member-wide RLS allowed direct DML on `ai_action_confirmations`. A member could forge or alter confirmation records rather than use the controlled confirmation flow. | **Fix staged** in the same migration: direct DML revoked; confirmation RPCs enforce sales-capable roles. SQL behavior not yet executed against a test database. |
| ER-003 | **High** | Live DB showed `create_order_atomic(...)` executable by `PUBLIC` and `anon`. The function checks auth/role internally, but the exposed execute grant is unnecessary. | **Fix staged**: revoke PUBLIC/anon and grant only authenticated/service role. Verify after migration. |
| ER-004 | **High** | `POST /api/orders` called `create_order_atomic` without the required `p_idempotency_key` argument, while the live DB signature has six arguments. Order creation would fail to resolve the RPC. | **Code fixed**: strict input validation, required `Idempotency-Key`, correct six-argument RPC call, safe errors, retry-aware audit check. Needs CI + API test. |
| ER-005 | **High** | WhatsApp status endpoint marked Evolution integrations `connected` after any successful HTTP response, including provider state `close`. | **Code fixed**: connection state normalized to connected/connecting/disconnected/QR-ready/preparing; raw Evolution status is no longer returned. Regression cases added. |
| ER-006 | **High** | Evolution setup previously stored a webhook secret without registering it with Evolution. | **Code fix staged**: setup and QR routes now register `/webhook/set/{instance}` with `MESSAGES_UPSERT` + `CONNECTION_UPDATE` and the tenant-specific secret header. Unit tests cover the request. **Real provider delivery remains unverified.** |
| ER-007 | **High** | Evolution base URL is user-controlled and server-side requests are made to it. | **Partially hardened**: rejects IP literals and private/reserved DNS answers, and provider requests reject redirects. DNS rebinding cannot be ruled out because native `fetch` resolves the hostname again; a strict outbound network boundary or pinned resolver is still required for a complete SSRF guarantee. |
| ER-008 | **High** | A webhook receipt left in `processing` after a crash was treated as a duplicate forever. | **Code + migration staged**: added `processing_started_at`, five-minute stale lease detection and compare-and-set claim; failure retry remains supported. Needs isolated DB/concurrency verification. |
| ER-009 | **High** | Role authorization was inconsistent across AI chat, customer updates, conversation updates and order creation. | **Code + migration staged**: API guards added; privileged order/confirmation RPCs enforce sales-capable roles and direct DML is revoked in the staged migration. Static contract tests added; authenticated role-denial tests remain unverified. |
| ER-010 | **High** | Audit writes are often separate requests after the business mutation; generic audit inserts remain available to tenant members. | **Partially fixed**: staged `create_order_atomic` writes the order audit in the same transaction; direct audit update/delete grants are revoked. Customer/conversation/integration audit writes still need atomicity, and generic audit insertion remains a spoofing risk. |
| ER-011 | **High** | `getTenantContext()` previously selected the earliest membership for a user with multiple workspaces. | **Code staged:** explicit active workspace cookie, membership-verified selection API and workspace selector page added. The user can auto-enter only when exactly one membership exists; multi-workspace users must choose. CI and multi-workspace route UX still require verification. |
| ER-012 | **Medium** | Repository has no lockfile in the audited branch; `vitest` uses a semver range and CI uses `npm install`. Dependency resolution can drift between CI and deployment. | **Open**: generate/commit the lockfile, use `npm ci`, and assess reported dependency advisories without blind force-upgrades. |
| ER-013 | **Medium** | Supabase security advisor reports leaked-password protection disabled. It also warns about the authenticated-callable `bootstrap_tenant` SECURITY DEFINER function; its empty search path and auth.uid() check are present, so this warning requires intentional RPC review rather than blindly removing the function. | **Open / configuration**: enable leaked-password protection in Auth settings; retain bootstrap only with documented controls and repeated advisor review. |
| ER-014 | **Medium** | Existing security tests are primarily mocked/source-contract tests; real two-tenant RLS, role rejection, audit immutability, provider E2E and browser journeys are not yet proven. | **Open**: add isolated-database tests and browser smoke coverage before sign-off. |
| ER-017 | **High** | The dashboard exposed a manual `paid` transition even though no provider-backed payment verification path exists; the payment RPC accepted `paid` without a provider receipt. | **Code + migration staged**: dashboard no longer offers manual `paid`; payment RPC returns `payment_verification_required` until a verified payment integration exists. Provider webhook-to-payment settlement remains unimplemented. |\n| ER-018 | **Audit correction** | The audit patch initially added a duplicate Meta GET handler because the endpoint already had a verification handshake. The duplicate caused a TypeScript compile failure. | **Corrected on the audit branch**: duplicate handler removed; regression test aligned with the existing handler. CI now passes. Live Meta handshake remains unverified; this is not a newly delivered integration feature. |\n| ER-016 | **Critical** | The live `ai_action_confirmations` table has a NOT NULL `payload_hash`, but the checked-in initial migration omitted that column and the original `create_order_confirmation` RPC did not populate it. This makes the order-confirmation path inconsistent across fresh installs and the live schema. | **Fix staged**: add/backfill payload hashes, require hashes on new confirmations, and verify the hash before execution. Needs disposable-database migration execution. |\n| ER-015 | **Product gap** | Requirement matrix itself marks website widget/crawler, Shopify/WooCommerce, Google Sheets, analytics, admin, follow-up worker and several provider adapters as NOT STARTED or IN PROGRESS. | **Open**: these are incomplete product requirements, not completed features; do not market them as live. |

## Live database observations

- All inspected public tables had RLS enabled.
- The `audit_logs` policy set observed in the live database has member read and actor-bound insert policies, with no update/delete policy. Table-level grants were broader than necessary, so the staged migration revokes audit mutation privileges.
- `integration_secrets` had an RLS policy denying authenticated access, but broad table grants remained; the staged migration revokes those grants as defense in depth.
- Supabase Security Advisor reported leaked-password protection disabled and one authenticated-callable SECURITY DEFINER function (`bootstrap_tenant`). Performance Advisor listed 52 unused indexes; on a low-traffic project these are observations, not a reason to drop indexes without workload evidence.

## Verification status

- **Passed:** GitHub Actions security regression workflow at commit `b5a2497b553e1fe12a8b45f9f289eaaf168e0714` completed successfully on 2026-10-10: dependency install, security regression tests, and TypeScript type-check all passed. This validates current code/tests in CI, not database migration execution, live provider behavior, or production deployment. Latest Vercel preview build checks remain blocked by Vercel build-rate-limit status; production has not been promoted.
- **CI passed (code-level only):** Evolution state normalization + tests; Evolution webhook registration + redacted receipts + stale lease recovery; SSRF filtering/redirect rejection; role guards for AI chat/customer/conversation/order APIs; order API idempotency/RPC signature fix; staged SQL hardening, atomic order audit, confirmation payload hashing + static contract tests.
- **Unverified:** live Evolution QR/webhook delivery, live Meta GET/POST handshake, two-tenant RLS attack tests, real role-denial tests, audit tamper tests, SQL migration execution on a disposable database, browser E2E, and production smoke tests. The generic authenticated audit-log INSERT policy remains a spoofing risk; audit integrity is not signed off.
- **Release gate:** NO MERGE / NO PRODUCTION DEPLOY until the migration is validated off-production, latest CI and build pass, high/critical findings are closed, role/tenant/audit tests pass, and provider/browser smoke tests are recorded.

## Addendum — Shared Inbox reliability layer (2026-10-10)

| ID | Severity | Finding / evidence | Disposition |
|---|---|---|---|
| ER-019 | **Medium** | Shared Inbox did not explicitly acknowledge unread inbound messages when an agent opened a conversation, so unread badges could remain stale until another refresh or provider update. | **Code + contract test added** on `test/security-regression-suite`: opening a conversation POSTs to a tenant-scoped read endpoint; endpoint checks the authenticated tenant and role, verifies conversation ownership in that tenant, and only marks unread inbound messages for that conversation as read. The UI clears that conversation's unread count only when the endpoint succeeds. |

### Shared Inbox verification

- **Passed:** GitHub Actions run [38019533143](https://github.com/Alishair5-crypto/EasyReach/actions/runs/38019533143), commit `388be78301c4d1dd2ed8a67d40974f6b58b66144`: dependency installation, security regression tests (including the new inbox read-state contract), TypeScript type-check, and Next.js production build all succeeded.
- **Passed:** Inbox assignment/channel-filter UI and TikTok filter follow-up runs [38018389857](https://github.com/Alishair5-crypto/EasyReach/actions/runs/38018389857), [38018407391](https://github.com/Alishair5-crypto/EasyReach/actions/runs/38018407391), and [38018412782](https://github.com/Alishair5-crypto/EasyReach/actions/runs/38018412782) all completed successfully.
- **Scope limit:** The inbox read-state test is a source/contract regression test, not a live multi-tenant database test. Real RLS enforcement, concurrent unread-count behavior, browser interaction, and live message-provider flows remain unverified. This does not close ER-010 audit integrity concerns or any critical release blocker.
- **Release decision unchanged:** NO MERGE / NO PRODUCTION DEPLOY until the critical/high security and audit findings, off-production migration execution, live provider checks, and end-to-end tenant/role tests are resolved and documented.


## Addendum — Conversation mutation and message payload reliability (2026-10-10)

| ID | Severity | Finding / evidence | Disposition |
|---|---|---|---|
| ER-020 | **High** | Shared Inbox conversation PATCH previously committed a conversation update and then attempted to insert its audit event in a separate request. If the audit insert failed, the API returned an error after the state had already changed. | **Code + migration staged:** the API validates the patch and calls `update_conversation_atomic`; the new SECURITY DEFINER RPC validates authenticated tenant membership and role, scopes the target conversation by tenant and ID, validates assignees against tenant membership, updates the record, and writes the audit event in the same database transaction. The migration is not applied to production and still requires isolated-database execution and authorization tests. |
| ER-021 | **Medium** | Outbound WhatsApp message parsing accepted an untyped provider response and silently truncated user input to 4,096 characters. | **Code changed:** provider message IDs are extracted from `unknown` using runtime object checks, malformed request bodies are rejected, and oversized messages receive a validation error instead of being silently truncated. Provider-send/persistence atomicity remains a separate open reliability concern. |

### Verification and limitations

- The initial CI runs for this change failed at the pre-existing source-contract assertion that expected an inline role array. The test was updated to match the typed allowlist; this was a test-contract mismatch, not evidence that the authorization check had been removed.
- The workflow for the updated test commit must be checked before reporting this phase as passed.
- The new database function has not yet been executed against a disposable Supabase database. Static source-contract tests do not prove SQL runtime behavior, RLS enforcement or live role-denial behavior.
- The existing generic audit-log INSERT spoofing risk remains open. This change makes this specific conversation mutation and its audit event atomic, but does not close overall audit integrity.
- **Release gate unchanged:** NO MERGE / NO PRODUCTION DEPLOY until all mandatory security, database, provider and end-to-end checks pass.


### Follow-up verification — conversation mutation phase

- **Passed:** GitHub Actions [38022678426](https://github.com/Alishair5-crypto/EasyReach/actions/runs/38022678426), commit `f59eb3c6bc62d99ea87eaf297973ad2306fadad4`: dependency installation, security regression tests, TypeScript type-check, and Next.js production build passed.
- An earlier run failed because a source-contract assertion expected the role array to be declared inline; the typed allowlist was preserved and the assertion was corrected. The final code commit's full workflow passed.
- **Still unverified:** the new SQL RPC has not been run against a disposable Supabase database. Its tenant checks and atomic audit behavior are currently supported by code inspection and source-contract tests only. Live RLS/role-denial behavior, provider delivery, and browser E2E remain open.
- Conversation detail now checks the approved role allowlist and selects only the customer fields required by the inbox UI. Outbound WhatsApp payload validation was tightened, but provider-send versus database-persistence failure recovery remains open.
- **Release gate unchanged:** ACTIVE / NOT SIGNED OFF; NO MERGE / NO PRODUCTION DEPLOY.


## Addendum — Explicit active workspace selection (ER-011 implementation, 2026-10-10)

| ID | Severity | Finding / implementation | Verification status |
|---|---|---|---|
| ER-011 | **High** | `getTenantContext()` previously chose the earliest membership silently. It now uses a server-only HttpOnly active-workspace cookie, auto-selects only when exactly one membership exists, and refuses to resolve a tenant when multiple memberships exist without a valid selection. New workspace listing/selection endpoints verify membership against the authenticated user; the selection UI does not trust client-supplied tenant IDs. | Code and contract tests staged; CI and typecheck must pass before this phase can be considered verified. |

The active workspace cookie is `HttpOnly`, `SameSite=Strict`, scoped to `/`, and marked `Secure` in production. Every workspace selection is checked against `tenant_members` before setting it. The onboarding route directs users with multiple memberships to the explicit selector rather than treating them as new customers.

**Open verification:** all page-level redirects for missing tenant context must be reviewed for multi-workspace UX; live RLS and cross-tenant authorization tests remain required. No production DB change or deployment is made by this change. Release status remains ACTIVE / NOT SIGNED OFF.


## Addendum — Explicit active workspace selection (ER-011 implementation, 2026-10-10)

- `getTenantContext()` now reads a server-only `easyreach_active_workspace_id` cookie. It auto-selects only when the authenticated user has exactly one membership. If there are multiple memberships and no valid active selection, it returns no tenant instead of silently choosing one.
- Added `GET/POST /api/workspaces/active`. Workspace listings are derived from authenticated memberships; selection validates the submitted workspace ID against `tenant_members` for the signed-in user before setting an HttpOnly, SameSite=Strict cookie (Secure in production).
- Added `/workspaces/select` with a selector UI; onboarding routes existing multi-workspace users there instead of presenting new-workspace creation.
- **Verification:** security tests passed in CI at commit `9c962812a2d8e519608620925dcbfcaea3368b74`, but TypeScript typecheck failed because the tenant result was typed too loosely. The tenant shape has been corrected in a follow-up commit; a new full CI run must pass before this layer is considered verified.
- **Release gate unchanged:** no merge or production deployment. Live RLS, API authorization, and end-to-end multi-workspace switching still require verification.


### ER-011 verification update

- **Passed:** GitHub Actions [38025719180](https://github.com/Alishair5-crypto/EasyReach/actions/runs/38025719180) at commit `50a1383970410e22eed8909fb7bea759aa0db3dc`: all security regression tests, TypeScript type-check, and Next.js production build passed.
- Added active-workspace contract coverage for no silent earliest-membership selection, membership-validated selection, HttpOnly/SameSite cookie settings, and the intentional switch route.
- Dashboard and Settings now expose a workspace-switch link. The selection API remains server-validated; a client-submitted workspace ID alone never grants access.
- **Not yet verified:** live multi-tenant RLS behavior, browser-based switching with real accounts, session/cookie behavior in the deployed environment, and all protected page/API UX when workspace context is absent.
- **Release status:** ACTIVE / NOT SIGNED OFF. No production merge/deploy.
