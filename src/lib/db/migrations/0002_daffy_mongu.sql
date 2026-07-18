CREATE UNIQUE INDEX "pipeline_company_uidx" ON "pipeline" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_contact_uidx" ON "pipeline" USING btree ("contact_id");--> statement-breakpoint
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
BEGIN
  actor_id := nullif(current_setting('app.current_user_id', true), '')::uuid;
  configured_organization_id := nullif(current_setting('app.current_organization_id', true), '')::uuid;

  IF TG_OP = 'DELETE' THEN
    mutation_id := OLD.id::text;
    mutation_organization_id := COALESCE(OLD.organization_id, configured_organization_id);
  ELSE
    mutation_id := NEW.id::text;
    mutation_organization_id := COALESCE(NEW.organization_id, configured_organization_id);
  END IF;

  INSERT INTO public.audit_logs (
    organization_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    changes,
    metadata
  ) VALUES (
    mutation_organization_id,
    actor_id,
    lower(TG_OP),
    TG_TABLE_NAME,
    mutation_id,
    jsonb_build_object(
      'before', CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
      'after', CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
    ),
    jsonb_build_object('source', 'database_trigger')
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER companies_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.log_lead_mutation();--> statement-breakpoint
CREATE TRIGGER contacts_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.contacts
FOR EACH ROW EXECUTE FUNCTION public.log_lead_mutation();--> statement-breakpoint
CREATE TRIGGER pipeline_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.pipeline
FOR EACH ROW EXECUTE FUNCTION public.log_lead_mutation();
