CREATE TYPE "public"."ingestion_run_status" AS ENUM('queued', 'dispatched', 'processing', 'complete', 'failed');--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"domain" varchar(253) NOT NULL,
	"target_titles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usage_date" date NOT NULL,
	"status" "ingestion_run_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingestion_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingestion_runs_organization_status_idx" ON "ingestion_runs" USING btree ("organization_id","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "ingestion_runs_next_attempt_idx" ON "ingestion_runs" USING btree ("status","next_attempt_at");
--> statement-breakpoint
CREATE TRIGGER ingestion_runs_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.ingestion_runs
FOR EACH ROW EXECUTE FUNCTION public.log_lead_mutation();
