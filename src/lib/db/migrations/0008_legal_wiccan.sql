ALTER TABLE "companies" ADD COLUMN "icp_rationale" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "icp_signals" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "research_summary" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "research_pain_points" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "research_signals" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "call_prep" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "outreach_draft" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "outreach_draft_at" timestamp with time zone;