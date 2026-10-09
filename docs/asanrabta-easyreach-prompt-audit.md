# AsanRabta → EasyReach Prompt / Architecture Audit

Date: 2026-10-08
Branch audited: feat/whatsapp-evolution-production-hardening
Audited repository state: commit 5116ade1dee47bab37d546eba1a7e7695a23a190

## Audit objective
Compare the recovered AsanRabta architecture, EasyReach V11/V11.1 direction and the current EasyReach implementation. Preserve the proven wheel while identifying omissions, contradictions and unverified areas.

## Classification
- EXTRACTED: requirement is present in the recovered source architecture.
- IMPLEMENTED: meaningful implementation exists.
- PARTIAL: some layers exist but the production workflow is incomplete.
- MISSING: no sufficient implementation.
- WRONG: implementation contradicts the agreed architecture/schema.
- UNVERIFIED: implementation exists but evidence is insufficient.

## Findings

### 1. Architecture / UX
- AsanRabta architecture: EXTRACTED.
- Simple onboarding path: IMPLEMENTED/PARTIAL. Current onboarding creates business + agent, but the full guided sequence through integrations, Business Brain, rules, test and activation is not yet one coherent guided flow.
- Central Integration Hub: PARTIAL. Current Channels page exists, but several provider adapters are not implemented.
- Business Brain as authoritative context: PARTIAL. Foundation exists; ingestion, verification, limits and broader context orchestration remain.
- Master Agent + 8 specialist architecture: PARTIAL/UNVERIFIED. Master runtime exists, but specialist boundaries are not yet fully represented as independently testable bounded capabilities in the repository.
- Shared Inbox: PARTIAL. UI and backend foundation exist; full omnichannel operation/handoff lifecycle is incomplete.
- Customer 360: PARTIAL. Foundation exists; complete identity resolution/activity/context needs further implementation.
- Unified commerce normalization: PARTIAL.

### 2. AI prompt/runtime
- NO DATA = NO CLAIM: IMPLEMENTED in the current Master Agent system prompt.
- External business content treated as untrusted: IMPLEMENTED at prompt level; requires continued tool/output validation.
- Read-only Test Bench: IMPLEMENTED.
- Production autonomous allowlist: IMPLEMENTED for the current safe set.
- Sensitive action confirmation: PARTIAL. Confirmation framework exists, but all high-risk actions/providers are not complete.
- Evidence/claim distinction: PARTIAL. Core rule exists; a formal evidence model/trace is not yet universal.
- Specialist orchestration: PARTIAL.
- Tool governance: PARTIAL. Tenant checks and validation exist, but every tool must be re-audited for schema/runtime alignment.

### 3. Concrete repository mismatches discovered
1. lib/ai/action-tools.ts still contains runtime selects for legacy size/color fields on product_variants, while the current variant schema uses attributes. WRONG/REGRESSION; fix before catalog/AI signoff.
2. lib/ai/action-tools.ts searches knowledge_documents with status=ready while the current Business Brain/runtime contract uses active. WRONG; fix before Business Brain signoff.
3. docs/requirements-matrix.md is stale relative to the current implementation: it says WhatsApp is NOT STARTED even though real Meta/Evolution foundations exist, and it says AI specialists are pending without distinguishing the current Master runtime. Reconcile it rather than using it as current evidence.
4. Product creation quota uses count-then-insert behavior; concurrent requests can race. Resource-limit enforcement should be atomic.
5. Product API includes an inventory role although the current tenant role contract is owner/admin/manager/sales/support/viewer. Reconcile.
6. Business Brain knowledge limits and stronger verification semantics are not yet fully enforced.
7. Full live provider E2E verification is not complete; WhatsApp production readiness remains UNVERIFIED/PARTIAL.
8. Website crawler/widget, Shopify, WooCommerce, social, email, Sheets, CRM, POS and custom API are not all production-complete.
9. Billing/manual payment verification/admin control center are not complete.
10. Final Supabase security still requires verification of leaked-password protection and remaining advisor/performance findings before release.

## Prompt audit conclusion
The consolidated baseline preserves the proven architecture and explicitly prevents old/outdated AsanRabta implementation assumptions from overriding current EasyReach decisions.

The baseline is an architecture/product contract, not proof that every item is already implemented.

## Required next order
1. Fix concrete schema/runtime mismatches.
2. Reconcile requirements matrix.
3. Establish explicit Master Agent + 8 specialist contracts.
4. Finish Business Brain as the authoritative context layer.
5. Finish Integration Hub lifecycle.
6. Complete live WhatsApp verification.
7. Continue commerce/website/omnichannel.
8. Billing/admin.
9. Final security/E2E/release.

No feature stacking should bypass these gates.

## Follow-up audit — 2026-10-09

Branch: `fix/evolution-build-validated`, created from the current WhatsApp hardening PR head `49d994c289eafb15482aff6708d5bbc024c4379c`.

### Evidence reconciliation
- The earlier findings above describe the repository state at commit `5116ade1dee47bab37d546eba1a7e7695a23a190`; do not treat them as proof that the same defects remain in later commits.
- Re-inspection of current `lib/ai/action-tools.ts` shows product-variant queries use the schema's `attributes` field and knowledge retrieval filters `knowledge_documents.status = 'active'`. The two previously reported runtime/schema mismatches are not present in the current PR-head snapshot.
- The requirements matrix is now reconciled for the website widget and WhatsApp: both are PARTIAL/UNVERIFIED rather than NOT STARTED, because source foundations exist but end-to-end production verification is absent.
- A separate repair branch, `fix/build-literal-newlines`, reached Vercel READY after targeted source fixes. That preview is based on a diverged commit line and is **not** evidence that the current WhatsApp hardening PR branch builds; this branch must have its own preview build before promotion.

### Current release gates — still open
1. Build the current PR-derived branch and resolve every compiler/build failure without disabling checks.
2. Verify tenant isolation, atomic quotas/actions, webhook idempotency, secret handling, and integration status transitions against current schema/migrations.
3. Run a real Evolution instance connection and webhook round-trip, then test Meta only with configured credentials; no fabricated credentials or simulated success.
4. Test website widget CORS, conversation ownership, rate limits/abuse controls, and runtime persistence in a real browser.
5. Investigate five high-severity dependency audit findings and Supabase security advisor findings before production release.
6. Keep the production branch untouched until all required gates have evidence and an explicit sign-off.

The master baseline remains the controlling product/architecture contract; this report and the requirement matrix record evidence status, not permission to skip release gates.
