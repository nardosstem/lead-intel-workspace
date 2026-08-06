CREATE TYPE "public"."organization_usage_kind" AS ENUM('domain_ingestion', 'news_scan', 'ai_action');--> statement-breakpoint
CREATE TABLE "organization_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"usage_date" date NOT NULL,
	"kind" "organization_usage_kind" NOT NULL,
	"reservation_key" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_usage" ADD CONSTRAINT "organization_usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_usage_date_kind_key_uidx" ON "organization_usage" USING btree ("organization_id","usage_date","kind","reservation_key");--> statement-breakpoint
CREATE INDEX "organization_usage_organization_date_kind_idx" ON "organization_usage" USING btree ("organization_id","usage_date","kind");--> statement-breakpoint
CREATE TRIGGER organization_usage_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.organization_usage
FOR EACH ROW EXECUTE FUNCTION public.log_lead_mutation();
