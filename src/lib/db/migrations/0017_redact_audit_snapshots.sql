-- Bound future audit snapshots so contact PII, notes, and generated AI text
-- are not copied into every append-only mutation record.
CREATE OR REPLACE FUNCTION public.log_lead_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mutation_id text;
  mutation_organization_id uuid;
  actor_id uuid;
  configured_organization_id uuid;
  before_payload jsonb;
  after_payload jsonb;
  redacted_fields text[];
BEGIN
  actor_id := nullif(current_setting('app.current_user_id', true), '')::uuid;
  configured_organization_id := nullif(current_setting('app.current_organization_id', true), '')::uuid;
  IF actor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = actor_id) THEN actor_id := NULL; END IF;

  IF TG_OP = 'DELETE' THEN
    mutation_id := OLD.id::text;
    mutation_organization_id := COALESCE(OLD.organization_id, configured_organization_id);
  ELSE
    mutation_id := NEW.id::text;
    mutation_organization_id := COALESCE(NEW.organization_id, configured_organization_id);
  END IF;
  IF mutation_organization_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = mutation_organization_id) THEN
    mutation_organization_id := NULL;
  END IF;

  redacted_fields := CASE TG_TABLE_NAME
    WHEN 'contacts' THEN ARRAY['email','linkedin','notes','outreach_draft','outreach_draft_at','apollo_id']
    WHEN 'companies' THEN ARRAY['research_summary','research_pain_points','research_signals','call_prep','pain_points','outreach_draft','icp_rationale','icp_signals','enrichment_error']
    ELSE ARRAY[]::text[]
  END;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN before_payload := to_jsonb(OLD) - redacted_fields; END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN after_payload := to_jsonb(NEW) - redacted_fields; END IF;

  INSERT INTO public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, changes, metadata)
  VALUES (mutation_organization_id, actor_id, lower(TG_OP), TG_TABLE_NAME, mutation_id,
    jsonb_build_object('before', before_payload, 'after', after_payload),
    jsonb_build_object('source', 'database_trigger', 'redacted', true));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
