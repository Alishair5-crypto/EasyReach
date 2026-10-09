-- Recover webhook deliveries that were interrupted after receipt creation.
-- The lease timestamp lets retries atomically reclaim stale processing receipts.
alter table public.webhook_events
  add column if not exists processing_started_at timestamptz;

update public.webhook_events
set processing_started_at = received_at
where status = 'processing' and processing_started_at is null;

create index if not exists webhook_events_processing_lease_idx
  on public.webhook_events(status, processing_started_at)
  where status = 'processing';
