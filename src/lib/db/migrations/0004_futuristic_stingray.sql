ALTER TABLE "companies" ADD COLUMN "domain" varchar(253);--> statement-breakpoint
WITH normalized AS (
  SELECT
    id,
    organization_id,
    lower(regexp_replace(split_part(regexp_replace(website, '^https?://', '', 'i'), '/', 1), '^www[.]', '')) AS domain
  FROM companies
  WHERE website IS NOT NULL AND domain IS NULL
), unique_domains AS (
  SELECT organization_id, domain
  FROM normalized
  GROUP BY organization_id, domain
  HAVING count(*) = 1
)
UPDATE companies AS companies_table
SET domain = normalized.domain
FROM normalized
JOIN unique_domains ON unique_domains.organization_id = normalized.organization_id
  AND unique_domains.domain = normalized.domain
WHERE companies_table.id = normalized.id;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_organization_domain_uidx" ON "companies" USING btree ("organization_id","domain");
