create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  sku text,
  name text not null,
  attributes jsonb not null default '{}'::jsonb,
  price numeric,
  sale_price numeric,
  inventory_quantity numeric,
  availability boolean default true,
  images jsonb not null default '[]'::jsonb,
  external_id text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_product_variants_tenant_product on public.product_variants(tenant_id, product_id);
create index if not exists idx_product_variants_tenant_sku on public.product_variants(tenant_id, sku);
alter table public.product_variants enable row level security;
drop policy if exists product_variants_member on public.product_variants;
create policy product_variants_member on public.product_variants
  for all to authenticated
  using ((select private.is_tenant_member(product_variants.tenant_id)))
  with check ((select private.is_tenant_member(product_variants.tenant_id)));
grant select, insert, update, delete on public.product_variants to authenticated;
