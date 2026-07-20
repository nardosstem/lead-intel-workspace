CREATE UNIQUE INDEX "companies_id_organization_uidx" ON "companies" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_id_organization_uidx" ON "contacts" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_organization_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "public"."companies"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_company_organization_fk" FOREIGN KEY ("company_id","organization_id") REFERENCES "public"."companies"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_contact_organization_fk" FOREIGN KEY ("contact_id","organization_id") REFERENCES "public"."contacts"("id","organization_id") ON DELETE cascade ON UPDATE no action;
