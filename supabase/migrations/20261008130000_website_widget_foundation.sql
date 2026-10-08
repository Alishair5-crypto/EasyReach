alter table public.agents add column if not exists widget_public_key text;
alter table public.agents add column if not exists widget_allowed_origins jsonb not null default '[]'::jsonb;
create unique index if not exists agents_widget_public_key_unique on public.agents(widget_public_key) where widget_public_key is not null;
alter table public.agents add constraint agents_widget_allowed_origins_array_chk check (jsonb_typeof(widget_allowed_origins)='array');