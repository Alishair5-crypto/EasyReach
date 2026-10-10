-- Prevent tenant members from fabricating arbitrary audit history through PostgREST.
-- Trusted SECURITY DEFINER database transactions and server-only privileged routes
-- remain responsible for audit insertion. Do not apply to production before isolated DB validation.
revoke insert on table public.audit_logs from anon, authenticated;
grant select on table public.audit_logs to authenticated;

-- Keep audit history append-only for authenticated clients; no direct mutations.
revoke update, delete, truncate, references, trigger on table public.audit_logs from anon, authenticated;
