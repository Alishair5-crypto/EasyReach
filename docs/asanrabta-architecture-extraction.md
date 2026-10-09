# EasyReach — AsanRabta Architecture Extraction & Rebase Record

Status: LOCKED BASELINE SOURCE
Date: 2026-10-08

## Purpose
This document records the architecture and workflow patterns extracted from the prior AsanRabta work and reconciled with EasyReach V11/V11.1. It is an architecture extraction, not a claim that every capability is already implemented.

## Source hierarchy
1. AsanRabta-derived architecture and workflows: preserve proven concepts.
2. EasyReach V11: product/workforce evolution and current product direction.
3. EasyReach V11.1: simplified onboarding/integration-hub UX and operational flow.
4. Current EasyReach repository/schema/runtime: implementation truth.
5. Current locked EasyReach commercial decisions: override older pricing/plan assumptions.
6. Never copy an obsolete implementation detail merely because it existed in AsanRabta.

## Core principle
Do not reinvent the wheel. Reuse the proven AsanRabta architecture, then upgrade it for EasyReach. The system must be simple for the client while being sophisticated underneath.

## Canonical product model
EasyReach is a multi-tenant AI Sales Workforce SaaS:
- one business workspace can operate one or more AI sales agents;
- one Master Agent orchestrates specialist capabilities;
- specialists are internal capabilities, not separate customer-facing bots;
- Business Brain is the authoritative context layer;
- Integration Hub connects real external channels/data;
- Customer 360 and Shared Inbox join AI and human sales operations;
- tools mediate all meaningful AI actions;
- governance, permissions, evidence, audit, usage and tenant isolation surround the runtime.

## Canonical client workflow
CREATE BUSINESS
→ CREATE/CONFIGURE AGENT
→ INTEGRATION HUB
→ CONNECT REAL CHANNELS/DATA
→ BUSINESS BRAIN
→ SALES RULES/POLICIES
→ TEST
→ READINESS CHECK
→ ACTIVATE
→ AI WORKFORCE LIVE

No simulated connection, fake sync, fake payment, fake order or fake success state is acceptable.

## Workforce architecture
MASTER AGENT / ORCHESTRATOR
→ intent and conversation understanding
→ context assembly
→ specialist selection
→ tool selection
→ policy/permission checks
→ execution where permitted
→ result validation
→ response/handoff
→ audit/observability

The EasyReach workforce uses the established Master Agent + 8-specialist architecture. Specialists must be implemented as bounded capabilities with clear responsibilities, tool permissions, inputs/outputs and governance; do not create eight unrelated bots with duplicated memory or business logic.

## Business Brain
Business Brain is the authoritative business-context layer, not merely an FAQ page. It can contain verified:
- business identity/about/hours;
- FAQs;
- policies;
- shipping/delivery;
- returns/exchanges;
- payment methods;
- product/catalog facts;
- sales rules;
- operational instructions;
- approved brand language;
- other tenant-provided business knowledge.

Runtime retrieval must prefer authoritative active tenant data. No data means no claim. Observed fact, AI interpretation and prediction must not be conflated.

## Integration Hub
All integrations follow a real lifecycle:
NOT_CONNECTED → CONNECTING → AUTHENTICATING → VERIFYING → SYNCING → CONNECTED
and explicit failure/maintenance states such as AUTH_FAILED, SYNC_FAILED, DISCONNECTED, EXPIRED, RATE_LIMITED, CONFIGURATION_ERROR, REQUIRES_REAUTH.

Every integration needs real credentials handling, tenant binding, validation, sync state, error state, retries/backoff where appropriate, health/last-sync visibility, idempotency and auditability.

Target integration families:
- WhatsApp Meta Cloud API;
- WhatsApp Evolution API/QR;
- website/chat widget;
- Shopify;
- WooCommerce;
- Instagram;
- Facebook;
- TikTok;
- email;
- Google Sheets;
- CRM;
- POS;
- Custom API.

Availability of an integration is plan-controlled. Never display a capability as operational when it is not actually configured and verified.

## Channel/runtime pipeline
Inbound:
channel → authenticated webhook/event → tenant resolution → idempotency → normalization → customer identity → conversation → Master Agent → Business Brain/context → specialist/tool → governance → response → provider.

Outbound:
eligibility → consent/policy/window checks → approved template where required → rate limiting → send → provider result → audit.

Human handoff:
AI detects configured handoff condition → creates/updates handoff state → human receives context → conversation remains one timeline → AI must respect takeover/pause rules.

## Customer 360
Customer record must evolve toward:
identity, channel identities, conversations, interests, product interactions, orders, payment/order context, lead status, tags, notes, follow-ups, consent/opt-out and activity timeline.
Identity resolution must be tenant-scoped and channel-aware.

## Shared Inbox
Conversation list + active conversation + customer/order context.
The timeline must combine AI messages, human messages and system events. Handoff/takeover must be explicit and auditable.

## Commerce
Normalize external commerce sources into a tenant-owned canonical commerce model:
external source → adapter → normalization → validation → catalog/business brain → runtime.
Catalog supports products, variants, SKU, attributes, price, sale price, inventory, availability, images and source/external IDs.
Orders follow verification-first flow: product → variant → price → availability → customer/delivery/payment data → confirmation → order creation → external update where configured → customer confirmation.
AI may not claim an order/payment/update succeeded unless the underlying operation succeeded.

## AI tool governance
Read tools are safer than mutation tools. Current read capabilities include product, variant, inventory, price, knowledge, policy, customer and order retrieval. Production autonomous actions must be explicitly allowlisted. Sensitive actions require confirmation/configuration.
No unrestricted AI database access.
Tool execution must enforce tenant, role/permission, schema validation, business rules, idempotency and audit.

## Automation
Event → trigger → eligibility → rule → action → result → audit.
Supports future/targeted follow-ups, lead nurture, abandoned-cart recovery, re-engagement, broadcasts and integration-triggered workflows. Durable execution, retry/backoff and cancellation are required for production jobs.

## Analytics/reporting
Operational events are the source of truth. Analytics derive from conversations, leads, orders, customers, AI/tool events, integrations, automations and billing. Never manufacture metrics.
Support revenue/sales, conversion, customer growth, product performance, lead funnel, AI performance, channel response, broadcast/follow-up and team metrics with date/filter controls.

## Multi-tenancy/security
User → membership → tenant → tenant-owned resources.
Every sensitive query and mutation must be tenant scoped. Use application authorization plus database RLS. Frontend checks are never the security boundary.
Protect against IDOR, privilege escalation, cross-tenant leakage, injection, XSS/CSRF where applicable, SSRF, malicious uploads, webhook forgery/replay, rate abuse and secret exposure.
Credentials/secrets stay server-side and encrypted/appropriately protected. Never expose secrets to browser/client code.

## Auditability
Important actions record who, tenant, what, when, resource, old/new values where appropriate and reason. Integration, agent, security, billing, order and AI-action events must be traceable.

## Quality gate
AI output/action:
understand → retrieve evidence → reason → validate schema → business-rule check → permission check → safety/evidence check → execute → verify result → communicate.

## Testing
Unit + integration + E2E + security/RLS + AI quality + regression.
Critical edge cases include null/empty, bounds, format, time, concurrency, network failure, data integrity and permissions.
A successful build is necessary but not sufficient for production readiness.

## Release gate
Inspect → Audit → Plan → Implement → Build → Test → Security Audit → Verify → Sign Off.
Never claim production readiness without evidence.
