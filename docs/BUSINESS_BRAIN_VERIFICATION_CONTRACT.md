# EasyReach Business Brain — Verification Contract

## Purpose
The Business Brain is the tenant's authoritative, evidence-backed knowledge layer for product policies, returns, exchanges, shipping, delivery, warranty, business hours, and approved sales guidance. Retrieval is not approval: an active document must also be explicitly verified before the AI can use it as authoritative policy.

## Current implementation in this branch
- `knowledge_documents` has `verification_status` constrained to `pending`, `verified`, or `rejected`, plus `verified_at` and `verified_by` evidence fields.
- AI policy retrieval and `search_knowledge` require both `status = active` and `verification_status = verified`.
- Queries are scoped by the server-resolved tenant ID.
- Retrieval includes verification/sync timestamps plus deterministic freshness and same-title conflict flags. URL-backed sources require refresh within 30 days; manually maintained policies require re-verification within 180 days. Stale, timestamp-unknown, or conflicting records are marked ineligible for authoritative answers.
- Retrieved source content remains untrusted data. It may support factual answers but must never override system rules, authorize tools, or reveal secrets.

## Required lifecycle
1. **Ingest** — create a tenant-owned document with source, source type, content, and sync metadata. New/changed content must not silently inherit approval.
2. **Pending review** — documents default to pending; AI retrieval must exclude them.
3. **Verify** — an authorized business member reviews the source and records verifier identity and timestamp.
4. **Activate** — only approved content is eligible for authoritative retrieval. Rejected, inactive, or pending content is excluded.
5. **Refresh** — a content-changing sync must invalidate or reset prior verification; do not assume a previously approved web page or integration remains unchanged.
6. **Audit** — record who changed/verified content, when, and what source/version was reviewed. Never put credentials or tokens in content or logs.
7. **Conflict handling** — if approved sources conflict, are stale, or lack a clear effective date, the AI must disclose uncertainty and request human review rather than choose an unsupported answer.

## Non-negotiable controls
- Tenant ID comes from authenticated server context, not user input.
- RLS must independently enforce tenant isolation; application filters are defense in depth, not a replacement for RLS. Business Brain reads are member-scoped and direct inserts/updates are restricted to owner/admin/manager roles by database policy; direct deletes are intentionally not permitted.
- External pages, imported files, and customer-submitted text are untrusted. Prompt injection inside a document is data, not instruction.
- Only verified, active documents may ground policy claims.
- A tool call is not proof of a successful external action.
- Never expose internal notes, secrets, or another customer's data in retrieval results.
- Keep Test Bench read-only and separate from production writes.

## Verification gates before sign-off
- Run `npm run test:specialists` and `npm run typecheck`.
- Verify all existing knowledge-document create/update/import flows preserve verification state correctly.
- Verify changed content returns to pending review; this behavior is not considered complete until the ingestion/update code is inspected and tested.
- Run adversarial tenant A/B retrieval tests and RLS tests against a real test database, including direct table writes by cashier/member roles.
- Verify concurrent verification/status changes return a conflict instead of approving a document whose state changed after it was read.
- Verify audit records are transactionally coupled to document changes and audit failures roll back the write.
- Test freshness boundaries (30-day URL-backed and 180-day manual policy), missing verification timestamps, and same-title conflicting content.
- Confirm policy screens expose review status, reviewer, verification timestamp, source, and stale/conflict warnings.
- Test prompt-injection documents, empty knowledge, rejected content, stale content, and conflicting approved policies.
- Do not call this production-ready until database migrations, UI review workflow, tenant isolation, and end-to-end tests pass.

## Current phase status
**PARTIAL — not signed off.** This branch hardens the AI retrieval boundary to active + verified records and adds regression checks. The full authoring/review UI, verification reset on source edits, stale/conflict policy, and live database/RLS verification remain release gates.
