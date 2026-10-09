# Authenticated Business Brain security integration tests

The default contract suite does not contact Supabase. This integration suite uses actual Supabase Auth email/password sessions and the PostgREST API, and it writes unique test documents. Run it only against a **dedicated non-production test project** with the current migrations applied.

Required environment:
- `EASYREACH_INTEGRATION_ALLOW_WRITES=YES` (explicit write-safety acknowledgement)
- `SUPABASE_INTEGRATION_URL`
- `SUPABASE_INTEGRATION_ANON_KEY` (publishable/anon key only; never service-role)
- `SUPABASE_TEST_TENANT_A_ID`
- `SUPABASE_TEST_TENANT_B_ID` (distinct from A)
- `SUPABASE_TEST_EDITOR_EMAIL` and `SUPABASE_TEST_EDITOR_PASSWORD`
- `SUPABASE_TEST_VIEWER_EMAIL` and `SUPABASE_TEST_VIEWER_PASSWORD`

Fixture requirements:
- The editor identity is owner/admin/manager in both test tenants. Membership in both is deliberate: it verifies the immutable-tenant trigger independently of ordinary tenant-membership RLS.
- The viewer identity is a non-editor member of tenant A and has no membership in tenant B.
- Auth identities and memberships must already exist. The suite does not create users, tenants, or memberships.
- Test-created knowledge documents are uniquely named and archived during cleanup; audit entries are expected to remain as evidence.

Run with `npm run test:integration:security`. Without configuration, the test reports as skipped, not passed. Partial configuration fails fast. Do not put production credentials or tenant IDs in CI secrets.
