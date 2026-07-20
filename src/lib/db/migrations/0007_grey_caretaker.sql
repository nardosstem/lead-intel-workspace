ALTER TABLE "companies" ADD COLUMN "enrichment_run_id" uuid;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "enrichment_error" varchar(1000);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "enrichment_error_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "companies_enrichment_run_id_idx" ON "companies" USING btree ("organization_id","enrichment_run_id");