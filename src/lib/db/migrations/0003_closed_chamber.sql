ALTER TABLE "companies" ADD COLUMN "enrichment_status" varchar(40) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "icp_score" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "pain_points" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "outreach_draft" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "enriched_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "companies_enrichment_status_idx" ON "companies" USING btree ("organization_id","enrichment_status");--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_icp_score_check" CHECK ("companies"."icp_score" IS NULL OR ("companies"."icp_score" >= 0 AND "companies"."icp_score" <= 100));