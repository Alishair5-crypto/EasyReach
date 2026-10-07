alter table public.integrations
  add column if not exists provider_external_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists integrations_kind_external_unique
  on public.integrations(kind, provider_external_id)
  where provider_external_id is not null;

create index if not exists integrations_tenant_kind_idx
  on public.integrations(tenant_id, kind);

create unique index if not exists webhook_events_provider_external_unique
  on public.webhook_events(provider, external_event_id)
  where external_event_id is not null;

comment on column public.integrations.provider_external_id is
  'Provider-owned routing identifier. WhatsApp Meta uses phone_number_id; Evolution uses instance name.';

comment on column public.integrations.metadata is
  'Non-secret integration metadata only. Credentials must remain encrypted in integration_secrets.';