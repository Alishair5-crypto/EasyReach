alter table public.knowledge_documents add column if not exists verification_status text not null default 'pending' check (verification_status in ('pending','verified','rejected'));
alter table public.knowledge_documents add column if not exists verified_at timestamptz;
alter table public.knowledge_documents add column if not exists verified_by uuid references auth.users(id);
create index if not exists knowledge_verified_tenant_idx on public.knowledge_documents (tenant_id, status, verification_status);
