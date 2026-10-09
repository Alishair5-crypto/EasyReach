-- Constitutional Phase 0/1 database hardening.
-- Removes verified duplicate indexes and adds covering indexes for foreign keys
-- identified by Supabase performance advisors. No business behavior changes.

drop index if exists public.idx_audit_tenant_time;
drop index if exists public.idx_integrations_tenant_kind;
drop index if exists public.variants_product_idx;
drop index if exists public.uq_webhook_provider_event;

create index if not exists ai_action_confirmations_agent_id_idx on public.ai_action_confirmations(agent_id);
create index if not exists ai_action_confirmations_confirmed_by_idx on public.ai_action_confirmations(confirmed_by);
create index if not exists ai_action_confirmations_conversation_id_idx on public.ai_action_confirmations(conversation_id);
create index if not exists ai_action_confirmations_customer_id_idx on public.ai_action_confirmations(customer_id);
create index if not exists order_action_receipts_order_id_idx on public.order_action_receipts(order_id);
