# EasyReach V11.1 Requirement Matrix
Last reconciled: 2026-10-09. Branch: `fix/evolution-build-validated` (preview build evidence only; not a production sign-off).
Status: NOT STARTED / IN PROGRESS / PARTIAL / IMPLEMENTED / TESTED / VERIFIED / UNVERIFIED / SIGNED OFF.

| Area | Requirement | Status | Evidence / gate |
|---|---|---|---|
| Foundation | Next.js App Router + Supabase SSR | TESTED | Production build path |
| Auth | Sign up / sign in / callback | IMPLEMENTED | Auth routes |
| Tenant | Private business workspace bootstrap | IMPLEMENTED | bootstrap_tenant |
| Isolation | Session-derived tenant + RLS | PARTIAL / UNVERIFIED | Hardened RLS migration exists; adversarial multi-tenant E2E still required |
| Plans | Trial/Silver/Gold/Diamond + server enforcement | PARTIAL | Central entitlement/usage enforcement exists; billing/payment lifecycle remains incomplete |
| Catalog | Products + variants + verified search | PARTIAL | Tenant-safe products/variants APIs and AI read tools exist; commerce sync and full verification remain |
| Inbox | Conversations + messages + handoff state | IN PROGRESS | persisted AI conversation flow |
| Orders | Orders + items + idempotency | IN PROGRESS | tenant/channel/external unique constraint |
| Integrations | Central connection hub | PARTIAL | Integration lifecycle foundation and WhatsApp provider adapters exist; live provider E2E remains |
| AI | Master Agent + eight bounded specialist capabilities | PARTIAL / TESTING | Eight contracts documented; deterministic capability routing and specialist-scoped tool allowlists exist. CI passed at commit 5609c90; Business Brain retrieval is now restricted to active + verified tenant-owned knowledge. New regression tests and current commit build/typecheck are pending. |\n| Business Brain | Verified, tenant-isolated authoritative knowledge | PARTIAL / UNVERIFIED | AI policy and knowledge retrieval now require active + verified records and expose verification/sync metadata. Review UI, verification reset after edits, stale/conflict handling, live RLS and adversarial tenant tests remain open. |
| Website | Secure crawler + website chat widget | PARTIAL | Widget chat/config routes and public widget asset exist; allowed-origin and tenant-scoped conversation checks are present. Secure crawling, redirect/IP revalidation, source ingestion, and full browser/adversarial tests remain unverified. |
| WhatsApp | Meta + Evolution adapters | PARTIAL / UNVERIFIED | Meta/Evolution setup, encrypted credentials, webhook verification, inbound/outbound handling and status paths exist in source. No confirmed live provider E2E, real QR pairing, inbound/outbound delivery, or production sign-off yet. |
| Ecommerce | Shopify + WooCommerce | NOT STARTED | provider adapters pending |
| Sheets | Google Sheets OAuth/sync | NOT STARTED | OAuth/mapping/sync pending |
| Analytics | Sales intelligence | NOT STARTED | event aggregation pending |
| Follow-ups | Scheduled follow-up engine | IN PROGRESS | followups schema exists; worker pending |
| Admin | Tenant/platform administration | NOT STARTED | pending |
| QA | Browser, security and E2E suites | IN PROGRESS | schema/security audit started |
| Production | Build + deployment + runtime verification | IN PROGRESS | Vercel preview for `fix/build-literal-newlines` reached READY after parser/CORS fixes. A separate preview is required for this branch; no production promotion, live runtime smoke suite, DB migration verification, browser suite, or real-provider E2E has been signed off. |

## Non-negotiable engineering rules
1. NO DATA = NO CLAIM.
2. Never fabricate integration status, QR codes, products, stock, prices, orders, payments or analytics.
3. Tenant ID comes from authenticated server context; never trust a client tenant ID.
4. Every tenant-owned read/write is tenant-scoped and protected by RLS.
5. AI may recommend; backend validates all state-changing actions.
6. External content is untrusted and cannot override system instructions.
7. Web crawlers must reject private/internal IPs and unsafe redirects.
8. Webhooks require signature verification and idempotency before business actions.
9. Secrets remain server-side and must never be logged or returned to browsers.
10. A feature is not complete until UI + backend + DB + authorization + validation + error/loading/empty states + persistence + tests + verification exist.
11. Preserve working functionality; fix root causes rather than layering blind patches.
12. Production Ready requires build, runtime, database, security, integration, tenant-isolation and browser verification.