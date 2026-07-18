ALTER TABLE "contacts" ADD COLUMN "apollo_id" varchar(160);--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_organization_apollo_uidx" ON "contacts" USING btree ("organization_id","apollo_id");
