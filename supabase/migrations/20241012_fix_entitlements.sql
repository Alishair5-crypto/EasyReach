-- Phase 3: tenant entitlements with tenant-member read isolation.
-- Keep the table idempotent for environments where it was provisioned manually.

CREATE TABLE IF NOT EXISTS public.entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'trial'
    CHECK (plan IN ('trial', 'starter', 'pro', 'enterprise')),
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS entitlements_member_read ON public.entitlements;
CREATE POLICY entitlements_member_read
  ON public.entitlements
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_members AS tm
      WHERE tm.tenant_id = entitlements.tenant_id
        AND tm.user_id = (SELECT auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.handle_new_tenant_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.entitlements (tenant_id, plan, status)
  VALUES (NEW.id, 'trial', 'active')
  ON CONFLICT (tenant_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_tenant_created_entitlement ON public.tenants;
CREATE TRIGGER on_tenant_created_entitlement
  AFTER INSERT ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_tenant_entitlement();

-- Backfill existing tenants without overwriting existing entitlement rows.
INSERT INTO public.entitlements (tenant_id, plan, status)
SELECT t.id, 'trial', 'active'
FROM public.tenants AS t
ON CONFLICT (tenant_id) DO NOTHING;
