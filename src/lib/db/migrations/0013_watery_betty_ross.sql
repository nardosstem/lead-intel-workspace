CREATE TYPE "public"."lead_signal_status" AS ENUM('new', 'reviewed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."lead_signal_type" AS ENUM('ai_deployment', 'vendor_partnership', 'manual_review_hiring', 'public_failure', 'automation_commitment', 'other', 'unclassified');--> statement-breakpoint
CREATE TYPE "public"."lead_signal_urgency" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."news_source_type" AS ENUM('gdelt', 'rss');--> statement-breakpoint
CREATE TYPE "public"."signal_scan_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "company_news_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"news_item_id" uuid NOT NULL,
	"relevance_score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_news_items_relevance_score_check" CHECK ("company_news_items"."relevance_score" >= 0 AND "company_news_items"."relevance_score" <= 100)
);
--> statement-breakpoint
ALTER TABLE "company_news_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lead_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"news_item_id" uuid,
	"signal_type" "lead_signal_type" NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"workflow" varchar(240),
	"decision_maker_role" varchar(160),
	"rationale" varchar(2000),
	"evidence" varchar(2000),
	"urgency" "lead_signal_urgency" DEFAULT 'medium' NOT NULL,
	"recommended_action" varchar(2000),
	"status" "lead_signal_status" DEFAULT 'new' NOT NULL,
	"model" varchar(120),
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_signals_confidence_check" CHECK ("lead_signals"."confidence" >= 0 AND "lead_signals"."confidence" <= 100)
);
--> statement-breakpoint
ALTER TABLE "lead_signals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "monitoring_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"scan_frequency_days" integer DEFAULT 7 NOT NULL,
	"last_scanned_at" timestamp with time zone,
	"next_scan_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_targets_priority_check" CHECK ("monitoring_targets"."priority" >= 0 AND "monitoring_targets"."priority" <= 100),
	CONSTRAINT "monitoring_targets_scan_frequency_days_check" CHECK ("monitoring_targets"."scan_frequency_days" >= 1 AND "monitoring_targets"."scan_frequency_days" <= 90)
);
--> statement-breakpoint
ALTER TABLE "monitoring_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"canonical_url" varchar(2048) NOT NULL,
	"title" varchar(500) NOT NULL,
	"publisher" varchar(160),
	"source_domain" varchar(253),
	"source_type" "news_source_type" NOT NULL,
	"published_at" timestamp with time zone,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"excerpt" varchar(2000),
	"content_hash" varchar(128),
	"raw_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "news_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "signal_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "signal_scan_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"candidates_found" integer DEFAULT 0 NOT NULL,
	"articles_fetched" integer DEFAULT 0 NOT NULL,
	"signals_extracted" integer DEFAULT 0 NOT NULL,
	"error" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_scans_counts_check" CHECK ("signal_scans"."candidates_found" >= 0 AND "signal_scans"."articles_fetched" >= 0 AND "signal_scans"."signals_extracted" >= 0)
);
--> statement-breakpoint
ALTER TABLE "signal_scans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "company_news_items" ADD CONSTRAINT "company_news_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_news_items" ADD CONSTRAINT "company_news_items_company_organization_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "public"."companies"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_news_items" ADD CONSTRAINT "company_news_items_news_organization_fk" FOREIGN KEY ("news_item_id","organization_id") REFERENCES "public"."news_items"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_signals" ADD CONSTRAINT "lead_signals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_signals" ADD CONSTRAINT "lead_signals_company_organization_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "public"."companies"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_signals" ADD CONSTRAINT "lead_signals_news_organization_fk" FOREIGN KEY ("news_item_id","organization_id") REFERENCES "public"."news_items"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_targets" ADD CONSTRAINT "monitoring_targets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_targets" ADD CONSTRAINT "monitoring_targets_company_organization_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "public"."companies"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_scans" ADD CONSTRAINT "signal_scans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_news_items_organization_company_news_uidx" ON "company_news_items" USING btree ("organization_id","company_id","news_item_id");--> statement-breakpoint
CREATE INDEX "company_news_items_organization_company_idx" ON "company_news_items" USING btree ("organization_id","company_id");--> statement-breakpoint
CREATE INDEX "company_news_items_organization_news_idx" ON "company_news_items" USING btree ("organization_id","news_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_signals_organization_company_news_type_uidx" ON "lead_signals" USING btree ("organization_id","company_id","news_item_id","signal_type");--> statement-breakpoint
CREATE INDEX "lead_signals_organization_company_idx" ON "lead_signals" USING btree ("organization_id","company_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_signals_organization_type_idx" ON "lead_signals" USING btree ("organization_id","signal_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_targets_organization_company_uidx" ON "monitoring_targets" USING btree ("organization_id","company_id");--> statement-breakpoint
CREATE INDEX "monitoring_targets_due_idx" ON "monitoring_targets" USING btree ("organization_id","enabled","next_scan_at");--> statement-breakpoint
CREATE UNIQUE INDEX "news_items_organization_canonical_url_uidx" ON "news_items" USING btree ("organization_id","canonical_url");--> statement-breakpoint
CREATE UNIQUE INDEX "news_items_id_organization_uidx" ON "news_items" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "news_items_organization_published_at_idx" ON "news_items" USING btree ("organization_id","published_at");--> statement-breakpoint
CREATE INDEX "news_items_organization_source_type_idx" ON "news_items" USING btree ("organization_id","source_type");--> statement-breakpoint
CREATE INDEX "signal_scans_organization_created_idx" ON "signal_scans" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "signal_scans_organization_status_idx" ON "signal_scans" USING btree ("organization_id","status");
--> statement-breakpoint
CREATE TRIGGER monitoring_targets_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.monitoring_targets
FOR EACH ROW EXECUTE FUNCTION public.log_lead_mutation();
--> statement-breakpoint
CREATE TRIGGER news_items_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.news_items
FOR EACH ROW EXECUTE FUNCTION public.log_lead_mutation();
--> statement-breakpoint
CREATE TRIGGER company_news_items_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.company_news_items
FOR EACH ROW EXECUTE FUNCTION public.log_lead_mutation();
--> statement-breakpoint
CREATE TRIGGER lead_signals_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.lead_signals
FOR EACH ROW EXECUTE FUNCTION public.log_lead_mutation();
--> statement-breakpoint
CREATE TRIGGER signal_scans_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.signal_scans
FOR EACH ROW EXECUTE FUNCTION public.log_lead_mutation();
