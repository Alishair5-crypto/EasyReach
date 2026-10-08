create table if not exists public.agent_test_runs (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 agent_id uuid not null references public.agents(id) on delete cascade,
 status text not null check (status in ('passed','failed')),
 config_fingerprint text not null,
 test_message text not null,
 response_preview text,
 error_code text,
 actor_id uuid references auth.users(id),
 created_at timestamptz not null default now()
);
create index if not exists agent_test_runs_lookup_idx on public.agent_test_runs (tenant_id, agent_id, created_at desc);
alter table public.agent_test_runs enable row level security;
create policy agent_test_runs_member_read on public.agent_test_runs for select using (private.is_tenant_member(tenant_id));
