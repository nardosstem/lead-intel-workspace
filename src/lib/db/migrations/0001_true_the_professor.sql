CREATE TYPE "public"."pipeline_stage" AS ENUM('new', 'researching', 'qualified', 'contacted', 'replied', 'meeting', 'won', 'lost');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"website" varchar(500),
	"industry" varchar(120),
	"size" varchar(80),
	"location" varchar(160),
	"status" varchar(40) DEFAULT 'prospect' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"title" varchar(160),
	"email" varchar(320),
	"linkedin" varchar(500),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pipeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid,
	"contact_id" uuid,
	"stage" "pipeline_stage" DEFAULT 'new' NOT NULL,
	"next_follow_up_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_single_target_check" CHECK (num_nonnulls("pipeline"."company_id", "pipeline"."contact_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "pipeline" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "companies_organization_id_idx" ON "companies" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "companies_status_idx" ON "companies" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "companies_created_at_idx" ON "companies" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "contacts_organization_id_idx" ON "contacts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "contacts_company_id_idx" ON "contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "pipeline_organization_stage_idx" ON "pipeline" USING btree ("organization_id","stage");--> statement-breakpoint
CREATE INDEX "pipeline_company_id_idx" ON "pipeline" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "pipeline_contact_id_idx" ON "pipeline" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "pipeline_follow_up_idx" ON "pipeline" USING btree ("organization_id","next_follow_up_at");