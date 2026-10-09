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
| ER-006 | **High** | Evolution setup stores a webhook secret and the UI promises message/connection webhooks, but the current QR/setup path does not call Evolution's webhook-configuration endpoint. A QR alone therefore does not prove inbound events are wired. | **Open**: implement verified webhook setup and test a real inbound event before claiming the Evolution webhook is ready. |
| ER-007 | **High** | Evolution base URL is user-controlled and server-side requests are made to it. The current URL filter does not fully defend against IPv6/private DNS targets or redirects. | **Open**: SSRF hardening and redirect/DNS target validation required before accepting arbitrary Evolution hosts. |
| ER-008 | **High** | A webhook receipt left in `processing` after a crash is treated as a duplicate forever; retry reclaim currently applies only to `failed` receipts. | **Open**: implement an atomic, leased/stale-processing reclaim strategy and concurrency tests. |
| ER-009 | **High** | Role authorization is not consistently enforced at every API boundary (e.g. customer and conversation updates rely on membership/RLS rather than an explicit role matrix). | **Open**: define the canonical role matrix, enforce it in APIs and DB RPCs, and test viewer/support/sales/admin denial and allowance cases. |
| ER-010 | **High** | Audit writes are often separate requests after the business mutation; if audit insertion fails, the state change may already have committed. Current insert policy also permits tenant members to create arbitrary-looking audit events with their own actor ID. | **Open**: move sensitive mutations + audit records into atomic RPCs/triggers; narrow audit write capability and test tamper resistance. |
| ER-011 | **Medium** | `getTenantContext()` silently selects the earliest membership for a user with multiple workspaces, rather than an explicit active workspace. | **Open**: add explicit, server-validated workspace selection without trusting a raw tenant ID. |
| ER-012 | **Medium** | Repository has no lockfile in the audited branch; `vitest` uses a semver range and CI uses `npm install`. Dependency resolution can drift between CI and deployment. | **Open**: generate/commit the lockfile, use `npm ci`, and assess reported dependency advisories without blind force-upgrades. |
| ER-013 | **Medium** | Supabase security advisor reports leaked-password protection disabled. It also warns about the authenticated-callable `bootstrap_tenant` SECURITY DEFINER function; its empty search path and auth.uid() check are present, so this warning requires intentional RPC review rather than blindly removing the function. | **Open / configuration**: enable leaked-password protection in Auth settings; retain bootstrap only with documented controls and repeated advisor review. |
| ER-014 | **Medium** | Existing security tests are primarily mocked/source-contract tests; real two-tenant RLS, role rejection, audit immutability, provider E2E and browser journeys are not yet proven. | **Open**: add isolated-database tests and browser smoke coverage before sign-off. |
| ER-015 | **Product gap** | Requirement matrix itself marks website widget/crawler, Shopify/WooCommerce, Google Sheets, analytics, admin, follow-up worker and several provider adapters as NOT STARTED or IN PROGRESS. | **Open**: these are incomplete product requirements, not completed features; do not market them as live. |

## Live database observations

- All inspected public tables had RLS enabled.
- The `audit_logs` policy set observed in the live database has member read and actor-bound insert policies, with no update/delete policy. Table-level grants were broader than necessary, so the staged migration revokes audit mutation privileges.
- `integration_secrets` had an RLS policy denying authenticated access, but broad table grants remained; the staged migration revokes those grants as defense in depth.
- Supabase Security Advisor reported leaked-password protection disabled and one authenticated-callable SECURITY DEFINER function (`bootstrap_tenant`). Performance Advisor listed 52 unused indexes; on a low-traffic project these are observations, not a reason to drop indexes without workload evidence.

## Verification status

- **Passed:** GitHub Actions security regression workflow at commit `99dc79a159276de4272e0f31ece415f12a60b73e` reported success; Vercel preview build for that commit reported READY. These results predate the latest fixes and do not validate them.
- **Implemented, awaiting CI:** Evolution state normalization + tests; order API idempotency/RPC signature fix; staged SQL hardening migration + static contract tests.
- **Unverified:** live Evolution QR/webhook, Meta provider E2E, two-tenant RLS attack tests, real role-denial tests, audit tamper tests, SQL migration execution on a disposable database, browser E2E, and production smoke tests.
- **Release gate:** NO MERGE / NO PRODUCTION DEPLOY until the migration is validated off-production, latest CI and build pass, high/critical findings are closed, role/tenant/audit tests pass, and provider/browser smoke tests are recorded.
