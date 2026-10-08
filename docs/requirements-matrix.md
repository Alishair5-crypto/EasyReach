# EasyReach V11.1 Requirement Matrix
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
| AI | Master + specialist orchestration | PARTIAL | Master orchestrator, governed tools and readiness flow exist; bounded specialist contract/coverage remains |
| Website | Secure crawler + widget | NOT STARTED | SSRF/crawler/widget pending |
| WhatsApp | Meta + Evolution adapters | PARTIAL / UNVERIFIED | Meta/Evolution foundation, webhook handling and outbound adapters exist; real provider E2E/sign-off pending |
| Ecommerce | Shopify + WooCommerce | NOT STARTED | provider adapters pending |
| Sheets | Google Sheets OAuth/sync | NOT STARTED | OAuth/mapping/sync pending |
| Analytics | Sales intelligence | NOT STARTED | event aggregation pending |
| Follow-ups | Scheduled follow-up engine | IN PROGRESS | followups schema exists; worker pending |
| Admin | Tenant/platform administration | NOT STARTED | pending |
| QA | Browser, security and E2E suites | IN PROGRESS | schema/security audit started |
| Production | Build + deployment + runtime verification | IN PROGRESS | Deployment/build foundation exists; runtime, security and real-provider verification gates remain |

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