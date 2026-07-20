import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, sql } from "drizzle-orm";
import postgres from "postgres";

import {
  companies,
  contacts,
  organizations,
  pipeline,
  type PipelineStage,
} from "@/lib/db/schema";

loadEnvConfig(process.cwd());

const demoOrganizationId = "10000000-0000-4000-8000-000000000001";
const dayInMilliseconds = 24 * 60 * 60 * 1_000;
const seedStartedAt = new Date();

type CompanySeed = {
  id: string;
  name: string;
  website: string;
  industry: string;
  size: string;
  location: string;
  status: "prospect" | "customer" | "inactive";
  stage: PipelineStage;
  enrichmentStatus: "pending" | "complete" | "failed";
  icpScore: number | null;
  painPoints: string[];
  outreachDraft: string | null;
  nextFollowUpInDays: number | null;
  lastActivityDaysAgo: number;
  pipelineNotes: string;
};

type ContactSeed = {
  id: string;
  companyId: string;
  apolloId: string;
  name: string;
  title: string;
  email: string;
  linkedin: string;
  notes: string;
  stage: PipelineStage;
  nextFollowUpInDays: number | null;
  lastActivityDaysAgo: number;
  pipelineNotes: string;
};

/** Relative dates keep the dashboard useful whenever the seed is rerun. */
function fromNow(days: number): Date {
  return new Date(seedStartedAt.getTime() + days * dayInMilliseconds);
}

const companySeeds: CompanySeed[] = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Northstar Analytics",
    website: "https://northstaranalytics.example.com",
    industry: "B2B SaaS",
    size: "51-200",
    location: "New York, NY",
    status: "prospect",
    stage: "researching",
    enrichmentStatus: "complete",
    icpScore: 86,
    painPoints: [
      "Account research is spread across too many browser tabs.",
      "Revenue operations lacks a shared qualification workflow.",
      "Manual handoffs delay first-touch outreach.",
    ],
    outreachDraft:
      "Hi Maya, Northstar's growth makes consistent account research harder to scale. We help revenue teams turn scattered research into a repeatable workflow without adding another manual queue. Would a 20-minute workflow review be useful next week?",
    nextFollowUpInDays: -2,
    lastActivityDaysAgo: 2,
    pipelineNotes: "Confirm the Q4 research workflow and identify the owner of tooling decisions.",
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    name: "Harbor & Pine Logistics",
    website: "https://harborpine.example.com",
    industry: "Logistics",
    size: "201-500",
    location: "Chicago, IL",
    status: "prospect",
    stage: "qualified",
    enrichmentStatus: "complete",
    icpScore: 79,
    painPoints: [
      "Commercial teams use inconsistent account and territory definitions.",
      "Sales enablement cannot reliably measure process adoption.",
      "New reps need too much manual context before customer calls.",
    ],
    outreachDraft:
      "Hi Luis, Harbor & Pine's distributed commercial team likely spends valuable time standardizing context before reps can act. We help enablement leaders make account intelligence consistent and measurable. Open to comparing notes on your current process?",
    nextFollowUpInDays: 2,
    lastActivityDaysAgo: 5,
    pipelineNotes: "Qualified in discovery; waiting for the enablement process owner to confirm timing.",
  },
  {
    id: "20000000-0000-4000-8000-000000000003",
    name: "Cinderblock Health",
    website: "https://cinderblockhealth.example.com",
    industry: "Healthcare technology",
    size: "11-50",
    location: "Boston, MA",
    status: "customer",
    stage: "won",
    enrichmentStatus: "complete",
    icpScore: 93,
    painPoints: [
      "Small GTM teams need leverage without expanding headcount.",
      "Compliance-sensitive research is difficult to standardize.",
      "Leadership lacks a single view of active partner conversations.",
    ],
    outreachDraft:
      "Hi Elena, Cinderblock's team is a strong fit for a focused intelligence workflow. We can help keep partner research structured and auditable as you scale. I would love to use our next check-in to map the expansion workflow.",
    nextFollowUpInDays: 7,
    lastActivityDaysAgo: 1,
    pipelineNotes: "Won account; schedule the expansion review and capture the first customer outcome.",
  },
  {
    id: "20000000-0000-4000-8000-000000000004",
    name: "Brightforge Security",
    website: "https://brightforge.example.com",
    industry: "Cybersecurity",
    size: "201-500",
    location: "Austin, TX",
    status: "prospect",
    stage: "new",
    enrichmentStatus: "pending",
    icpScore: null,
    painPoints: [],
    outreachDraft: null,
    nextFollowUpInDays: 0,
    lastActivityDaysAgo: 0,
    pipelineNotes: "New target account; identify the security marketing and revenue operations owners.",
  },
  {
    id: "20000000-0000-4000-8000-000000000005",
    name: "Meadowline Finance",
    website: "https://meadowlinefinance.example.com",
    industry: "Fintech",
    size: "51-200",
    location: "Toronto, ON",
    status: "prospect",
    stage: "contacted",
    enrichmentStatus: "complete",
    icpScore: 78,
    painPoints: [
      "Regulated buyers require more precise account context.",
      "Research quality varies between new and experienced reps.",
      "Marketing and sales disagree on buying signals.",
    ],
    outreachDraft:
      "Hi Camille, fintech teams often need richer account context while keeping research repeatable and compliant. We help teams align buying signals before outreach. Is improving that handoff on Meadowline's roadmap this quarter?",
    nextFollowUpInDays: -1,
    lastActivityDaysAgo: 3,
    pipelineNotes: "Initial outreach sent; follow up with the revenue operations angle.",
  },
  {
    id: "20000000-0000-4000-8000-000000000006",
    name: "Atlasgrove Commerce",
    website: "https://atlasgrove.example.com",
    industry: "E-commerce software",
    size: "11-50",
    location: "San Francisco, CA",
    status: "prospect",
    stage: "replied",
    enrichmentStatus: "complete",
    icpScore: 91,
    painPoints: [
      "A lean team is balancing inbound demand with targeted outbound.",
      "Expansion accounts are not prioritized consistently.",
      "Founder-led sales knowledge is difficult to operationalize.",
    ],
    outreachDraft:
      "Hi Sofia, Atlasgrove's founder-led sales motion is a great point to systematize account context before the team grows. We help small GTM teams turn that knowledge into a repeatable workflow. Would it help to walk through a lightweight version?",
    nextFollowUpInDays: 1,
    lastActivityDaysAgo: 1,
    pipelineNotes: "Replied positively; propose a short workflow review with the founder and sales lead.",
  },
  {
    id: "20000000-0000-4000-8000-000000000007",
    name: "Orbitworks DevTools",
    website: "https://orbitworks.example.com",
    industry: "Developer tools",
    size: "51-200",
    location: "Seattle, WA",
    status: "prospect",
    stage: "qualified",
    enrichmentStatus: "complete",
    icpScore: 83,
    painPoints: [
      "Technical buyer research requires specialized context.",
      "Product-led signals are not connected to outbound prioritization.",
      "Sales engineers spend time rebuilding account briefs.",
    ],
    outreachDraft:
      "Hi Grace, developer-tool teams often have strong product signals but limited time to turn them into account plans. We help sales and solutions teams share a consistent research brief before a technical conversation. Worth a quick conversation?",
    nextFollowUpInDays: 3,
    lastActivityDaysAgo: 4,
    pipelineNotes: "Qualified by product-led growth motion; validate the sales engineering workflow.",
  },
  {
    id: "20000000-0000-4000-8000-000000000008",
    name: "Redwood Renewables",
    website: "https://redwoodrenewables.example.com",
    industry: "Energy software",
    size: "201-500",
    location: "Denver, CO",
    status: "inactive",
    stage: "lost",
    enrichmentStatus: "complete",
    icpScore: 54,
    painPoints: [
      "Long buying cycles make timing difficult.",
      "Multiple stakeholder groups require separate value cases.",
      "The current quarter is focused on implementation work.",
    ],
    outreachDraft:
      "Hi Nora, thanks for the context on Redwood's implementation priorities. I will close the loop for now and check back when the commercial workflow becomes a focus again. Best of luck with the rollout.",
    nextFollowUpInDays: -4,
    lastActivityDaysAgo: 21,
    pipelineNotes: "Closed lost for timing; revisit after implementation planning resets.",
  },
  {
    id: "20000000-0000-4000-8000-000000000009",
    name: "Clearwater PeopleOps",
    website: "https://clearwaterpeopleops.example.com",
    industry: "Human resources technology",
    size: "11-50",
    location: "Atlanta, GA",
    status: "prospect",
    stage: "new",
    enrichmentStatus: "pending",
    icpScore: null,
    painPoints: [],
    outreachDraft: null,
    nextFollowUpInDays: 4,
    lastActivityDaysAgo: 0,
    pipelineNotes: "New target account; research the founder's current outbound process.",
  },
  {
    id: "20000000-0000-4000-8000-000000000010",
    name: "SummitGrid Energy",
    website: "https://summitgrid.example.com",
    industry: "Utilities technology",
    size: "501-1000",
    location: "Houston, TX",
    status: "customer",
    stage: "won",
    enrichmentStatus: "complete",
    icpScore: 96,
    painPoints: [
      "Large account teams need consistent territory intelligence.",
      "Partner and channel context is difficult to keep current.",
      "Executive reviews need a reliable audit trail for decisions.",
    ],
    outreachDraft:
      "Hi Aiden, SummitGrid is a strong example of where a shared intelligence workflow can compound across teams. For our next review, I would like to quantify the time saved in account planning and identify the next territory to expand.",
    nextFollowUpInDays: 10,
    lastActivityDaysAgo: 2,
    pipelineNotes: "Won account; prepare the quarterly value review and expansion plan.",
  },
];

const contactSeeds: ContactSeed[] = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    companyId: companySeeds[0].id,
    apolloId: "demo-apollo-northstar-maya-chen",
    name: "Maya Chen",
    title: "VP of Revenue Operations",
    email: "maya.chen@northstaranalytics.example.com",
    linkedin: "https://www.linkedin.com/in/maya-chen-demo",
    notes: "Evaluating ways to reduce manual account research before Q4.",
    stage: "contacted",
    nextFollowUpInDays: -2,
    lastActivityDaysAgo: 2,
    pipelineNotes: "Primary champion candidate; confirm process ownership and success metrics.",
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    companyId: companySeeds[1].id,
    apolloId: "demo-apollo-harbor-luis-romero",
    name: "Luis Romero",
    title: "Director of Sales Enablement",
    email: "luis.romero@harborpine.example.com",
    linkedin: "https://www.linkedin.com/in/luis-romero-demo",
    notes: "Owns process standardization across the commercial team.",
    stage: "new",
    nextFollowUpInDays: 2,
    lastActivityDaysAgo: 5,
    pipelineNotes: "Potential process owner; validate whether sales operations is also involved.",
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    companyId: companySeeds[0].id,
    apolloId: "demo-apollo-northstar-jonah-patel",
    name: "Jonah Patel",
    title: "Director of Demand Generation",
    email: "jonah.patel@northstaranalytics.example.com",
    linkedin: "https://www.linkedin.com/in/jonah-patel-demo",
    notes: "Owns campaign targeting and account-level intent programs.",
    stage: "researching",
    nextFollowUpInDays: 5,
    lastActivityDaysAgo: 6,
    pipelineNotes: "Secondary stakeholder; compare marketing and revenue qualification criteria.",
  },
  {
    id: "30000000-0000-4000-8000-000000000004",
    companyId: companySeeds[1].id,
    apolloId: "demo-apollo-harbor-priya-shah",
    name: "Priya Shah",
    title: "VP of Commercial Operations",
    email: "priya.shah@harborpine.example.com",
    linkedin: "https://www.linkedin.com/in/priya-shah-demo",
    notes: "Executive sponsor for process consistency across regions.",
    stage: "qualified",
    nextFollowUpInDays: 3,
    lastActivityDaysAgo: 4,
    pipelineNotes: "Executive stakeholder; use the enablement workflow as the entry point.",
  },
  {
    id: "30000000-0000-4000-8000-000000000005",
    companyId: companySeeds[2].id,
    apolloId: "demo-apollo-cinderblock-elena-brooks",
    name: "Dr. Elena Brooks",
    title: "Chief Operating Officer",
    email: "elena.brooks@cinderblockhealth.example.com",
    linkedin: "https://www.linkedin.com/in/elena-brooks-demo",
    notes: "Executive owner for partnerships and operational scale.",
    stage: "won",
    nextFollowUpInDays: 7,
    lastActivityDaysAgo: 1,
    pipelineNotes: "Customer sponsor; capture expansion use cases during the next review.",
  },
  {
    id: "30000000-0000-4000-8000-000000000006",
    companyId: companySeeds[2].id,
    apolloId: "demo-apollo-cinderblock-marcus-bell",
    name: "Marcus Bell",
    title: "Head of Partnerships",
    email: "marcus.bell@cinderblockhealth.example.com",
    linkedin: "https://www.linkedin.com/in/marcus-bell-demo",
    notes: "Day-to-day user for partner research and follow-up tracking.",
    stage: "meeting",
    nextFollowUpInDays: 4,
    lastActivityDaysAgo: 2,
    pipelineNotes: "Expansion user; validate adoption and identify another partner workflow.",
  },
  {
    id: "30000000-0000-4000-8000-000000000007",
    companyId: companySeeds[3].id,
    apolloId: "demo-apollo-brightforge-aisha-thompson",
    name: "Aisha Thompson",
    title: "VP of Marketing",
    email: "aisha.thompson@brightforge.example.com",
    linkedin: "https://www.linkedin.com/in/aisha-thompson-demo",
    notes: "Leads category positioning and target-account campaigns.",
    stage: "new",
    nextFollowUpInDays: 0,
    lastActivityDaysAgo: 0,
    pipelineNotes: "Primary marketing contact; research account-based campaign motion.",
  },
  {
    id: "30000000-0000-4000-8000-000000000008",
    companyId: companySeeds[3].id,
    apolloId: "demo-apollo-brightforge-owen-wright",
    name: "Owen Wright",
    title: "Director of Revenue Operations",
    email: "owen.wright@brightforge.example.com",
    linkedin: "https://www.linkedin.com/in/owen-wright-demo",
    notes: "Owns systems and reporting for the growing commercial team.",
    stage: "researching",
    nextFollowUpInDays: 6,
    lastActivityDaysAgo: 1,
    pipelineNotes: "Potential systems owner; map the current research and routing stack.",
  },
  {
    id: "30000000-0000-4000-8000-000000000009",
    companyId: companySeeds[4].id,
    apolloId: "demo-apollo-meadowline-camille-laurent",
    name: "Camille Laurent",
    title: "Chief Revenue Officer",
    email: "camille.laurent@meadowlinefinance.example.com",
    linkedin: "https://www.linkedin.com/in/camille-laurent-demo",
    notes: "Executive sponsor for the commercial operating model.",
    stage: "contacted",
    nextFollowUpInDays: -1,
    lastActivityDaysAgo: 3,
    pipelineNotes: "Follow up on regulated-buyer research and qualification consistency.",
  },
  {
    id: "30000000-0000-4000-8000-000000000010",
    companyId: companySeeds[4].id,
    apolloId: "demo-apollo-meadowline-ethan-park",
    name: "Ethan Park",
    title: "Head of Sales Operations",
    email: "ethan.park@meadowlinefinance.example.com",
    linkedin: "https://www.linkedin.com/in/ethan-park-demo",
    notes: "Owns CRM process design and reporting quality.",
    stage: "qualified",
    nextFollowUpInDays: 3,
    lastActivityDaysAgo: 4,
    pipelineNotes: "Technical evaluator for process and reporting requirements.",
  },
  {
    id: "30000000-0000-4000-8000-000000000011",
    companyId: companySeeds[5].id,
    apolloId: "demo-apollo-atlasgrove-sofia-martinez",
    name: "Sofia Martinez",
    title: "Co-founder and CEO",
    email: "sofia.martinez@atlasgrove.example.com",
    linkedin: "https://www.linkedin.com/in/sofia-martinez-demo",
    notes: "Founder-led sales owner and product vision lead.",
    stage: "replied",
    nextFollowUpInDays: 1,
    lastActivityDaysAgo: 1,
    pipelineNotes: "Positive reply; keep the next step lightweight and founder-friendly.",
  },
  {
    id: "30000000-0000-4000-8000-000000000012",
    companyId: companySeeds[5].id,
    apolloId: "demo-apollo-atlasgrove-noah-kim",
    name: "Noah Kim",
    title: "Head of Growth",
    email: "noah.kim@atlasgrove.example.com",
    linkedin: "https://www.linkedin.com/in/noah-kim-demo",
    notes: "Owns pipeline generation and expansion experiments.",
    stage: "contacted",
    nextFollowUpInDays: 2,
    lastActivityDaysAgo: 2,
    pipelineNotes: "Growth stakeholder; connect account intelligence to expansion signals.",
  },
  {
    id: "30000000-0000-4000-8000-000000000013",
    companyId: companySeeds[6].id,
    apolloId: "demo-apollo-orbitworks-grace-liu",
    name: "Grace Liu",
    title: "VP of Sales",
    email: "grace.liu@orbitworks.example.com",
    linkedin: "https://www.linkedin.com/in/grace-liu-demo",
    notes: "Leads enterprise sales and technical discovery standards.",
    stage: "qualified",
    nextFollowUpInDays: 3,
    lastActivityDaysAgo: 4,
    pipelineNotes: "Primary commercial sponsor; validate technical discovery bottlenecks.",
  },
  {
    id: "30000000-0000-4000-8000-000000000014",
    companyId: companySeeds[6].id,
    apolloId: "demo-apollo-orbitworks-ben-carter",
    name: "Ben Carter",
    title: "Director of Solutions Engineering",
    email: "ben.carter@orbitworks.example.com",
    linkedin: "https://www.linkedin.com/in/ben-carter-demo",
    notes: "Owns technical evaluation and solution brief quality.",
    stage: "researching",
    nextFollowUpInDays: 5,
    lastActivityDaysAgo: 6,
    pipelineNotes: "Key workflow user; quantify time spent rebuilding account briefs.",
  },
  {
    id: "30000000-0000-4000-8000-000000000015",
    companyId: companySeeds[7].id,
    apolloId: "demo-apollo-redwood-nora-ibrahim",
    name: "Nora Ibrahim",
    title: "VP of Partnerships",
    email: "nora.ibrahim@redwoodrenewables.example.com",
    linkedin: "https://www.linkedin.com/in/nora-ibrahim-demo",
    notes: "Former champion; requested a pause during implementation.",
    stage: "lost",
    nextFollowUpInDays: -4,
    lastActivityDaysAgo: 21,
    pipelineNotes: "Closed lost for timing; do not re-engage until the review date.",
  },
  {
    id: "30000000-0000-4000-8000-000000000016",
    companyId: companySeeds[7].id,
    apolloId: "demo-apollo-redwood-theo-grant",
    name: "Theo Grant",
    title: "Director of Commercial Strategy",
    email: "theo.grant@redwoodrenewables.example.com",
    linkedin: "https://www.linkedin.com/in/theo-grant-demo",
    notes: "Stakeholder for future territory planning and partner programs.",
    stage: "lost",
    nextFollowUpInDays: null,
    lastActivityDaysAgo: 28,
    pipelineNotes: "Archived with the account until the implementation cycle closes.",
  },
  {
    id: "30000000-0000-4000-8000-000000000017",
    companyId: companySeeds[8].id,
    apolloId: "demo-apollo-clearwater-olivia-reed",
    name: "Olivia Reed",
    title: "Founder and CEO",
    email: "olivia.reed@clearwaterpeopleops.example.com",
    linkedin: "https://www.linkedin.com/in/olivia-reed-demo",
    notes: "Founder-led sales and customer discovery owner.",
    stage: "new",
    nextFollowUpInDays: 4,
    lastActivityDaysAgo: 0,
    pipelineNotes: "Research before first touch; lead with founder leverage and repeatability.",
  },
  {
    id: "30000000-0000-4000-8000-000000000018",
    companyId: companySeeds[8].id,
    apolloId: "demo-apollo-clearwater-sam-okafor",
    name: "Sam Okafor",
    title: "Head of Customer Success",
    email: "sam.okafor@clearwaterpeopleops.example.com",
    linkedin: "https://www.linkedin.com/in/sam-okafor-demo",
    notes: "Sees recurring customer use cases that may inform ICP targeting.",
    stage: "researching",
    nextFollowUpInDays: 7,
    lastActivityDaysAgo: 1,
    pipelineNotes: "Secondary contact; use customer patterns to sharpen target account criteria.",
  },
  {
    id: "30000000-0000-4000-8000-000000000019",
    companyId: companySeeds[9].id,
    apolloId: "demo-apollo-summitgrid-aiden-brooks",
    name: "Aiden Brooks",
    title: "Chief Commercial Officer",
    email: "aiden.brooks@summitgrid.example.com",
    linkedin: "https://www.linkedin.com/in/aiden-brooks-demo",
    notes: "Executive sponsor for account planning and expansion.",
    stage: "won",
    nextFollowUpInDays: 10,
    lastActivityDaysAgo: 2,
    pipelineNotes: "Customer sponsor; prepare quarterly value and territory expansion review.",
  },
  {
    id: "30000000-0000-4000-8000-000000000020",
    companyId: companySeeds[9].id,
    apolloId: "demo-apollo-summitgrid-leila-haddad",
    name: "Leila Haddad",
    title: "Director of Channel Strategy",
    email: "leila.haddad@summitgrid.example.com",
    linkedin: "https://www.linkedin.com/in/leila-haddad-demo",
    notes: "Owns partner intelligence and channel planning workflows.",
    stage: "meeting",
    nextFollowUpInDays: 6,
    lastActivityDaysAgo: 3,
    pipelineNotes: "Expansion stakeholder; map partner workflow and reporting requirements.",
  },
];

async function seed() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to seed leads.");
  }

  const client = postgres(databaseUrl, { prepare: false });
  const db = drizzle(client, {
    schema: { companies, contacts, organizations, pipeline },
  });

  let insertedCompanies = 0;
  let updatedCompanies = 0;
  let insertedContacts = 0;
  let updatedContacts = 0;
  let insertedPipelineRows = 0;
  let updatedPipelineRows = 0;

  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.current_user_id', '', true), set_config('app.current_organization_id', ${demoOrganizationId}, true)`,
      );

      await tx
        .insert(organizations)
        .values({
          id: demoOrganizationId,
          name: "Lead Intel Demo Organization",
          slug: "lead-intel-demo",
        })
        .onConflictDoNothing();

      const existingCompanyRows = await tx
        .select({
          id: companies.id,
          name: companies.name,
          domain: companies.domain,
          website: companies.website,
          industry: companies.industry,
          size: companies.size,
          location: companies.location,
          status: companies.status,
          enrichmentStatus: companies.enrichmentStatus,
          icpScore: companies.icpScore,
          painPoints: companies.painPoints,
          outreachDraft: companies.outreachDraft,
        })
        .from(companies)
        .where(eq(companies.organizationId, demoOrganizationId));
      const existingCompanies = new Map(
        existingCompanyRows.map((company) => [company.id, company]),
      );

      const existingContactRows = await tx
        .select({
          id: contacts.id,
          companyId: contacts.companyId,
          apolloId: contacts.apolloId,
          name: contacts.name,
          title: contacts.title,
          email: contacts.email,
          linkedin: contacts.linkedin,
          notes: contacts.notes,
        })
        .from(contacts)
        .where(eq(contacts.organizationId, demoOrganizationId));
      const existingContacts = new Map(
        existingContactRows.map((contact) => [contact.id, contact]),
      );

      const existingPipelineRows = await tx
        .select({
          id: pipeline.id,
          companyId: pipeline.companyId,
          contactId: pipeline.contactId,
          stage: pipeline.stage,
          nextFollowUpAt: pipeline.nextFollowUpAt,
          lastActivityAt: pipeline.lastActivityAt,
          notes: pipeline.notes,
        })
        .from(pipeline)
        .where(eq(pipeline.organizationId, demoOrganizationId));
      const existingPipeline = new Map(
        existingPipelineRows.map((row) => [row.id, row]),
      );

      for (const company of companySeeds) {
        const domain = new URL(company.website).hostname
          .replace(/^www\./, "")
          .toLowerCase();
        const companyValues = {
          name: company.name,
          domain,
          website: company.website,
          industry: company.industry,
          size: company.size,
          location: company.location,
          status: company.status,
          enrichmentStatus: company.enrichmentStatus,
          icpScore: company.icpScore,
          painPoints: company.painPoints,
          outreachDraft: company.outreachDraft,
        };
        const existingCompany = existingCompanies.get(company.id);

        if (!existingCompany) {
          const insertedCompanyRows = await tx
            .insert(companies)
            .values({
              id: company.id,
              organizationId: demoOrganizationId,
              ...companyValues,
            })
            .onConflictDoNothing()
            .returning({ id: companies.id });

          insertedCompanies += insertedCompanyRows.length;
        } else if (
          existingCompany.name !== companyValues.name ||
          existingCompany.domain !== companyValues.domain ||
          existingCompany.website !== companyValues.website ||
          existingCompany.industry !== companyValues.industry ||
          existingCompany.size !== companyValues.size ||
          existingCompany.location !== companyValues.location ||
          existingCompany.status !== companyValues.status ||
          existingCompany.enrichmentStatus !== companyValues.enrichmentStatus ||
          existingCompany.icpScore !== companyValues.icpScore ||
          JSON.stringify(existingCompany.painPoints) !==
            JSON.stringify(companyValues.painPoints) ||
          existingCompany.outreachDraft !== companyValues.outreachDraft
        ) {
          await tx
            .update(companies)
            .set(companyValues)
            .where(
              and(
                eq(companies.id, company.id),
                eq(companies.organizationId, demoOrganizationId),
              ),
            );
          updatedCompanies += 1;
        }

        const pipelineId = `40000000-0000-4000-8000-${company.id.slice(-12)}`;
        const nextFollowUpAt =
          company.nextFollowUpInDays === null
            ? null
            : fromNow(company.nextFollowUpInDays);
        const lastActivityAt = fromNow(-company.lastActivityDaysAgo);
        const existingCompanyPipeline = existingPipeline.get(pipelineId);

        if (!existingCompanyPipeline) {
          const insertedPipelineRowsForCompany = await tx
            .insert(pipeline)
            .values({
              id: pipelineId,
              organizationId: demoOrganizationId,
              companyId: company.id,
              stage: company.stage,
              nextFollowUpAt,
              lastActivityAt,
              notes: company.pipelineNotes,
            })
            .onConflictDoNothing()
            .returning({ id: pipeline.id });

          insertedPipelineRows += insertedPipelineRowsForCompany.length;
        } else {
          const shouldFillNextFollowUp =
            existingCompanyPipeline.nextFollowUpAt === null &&
            nextFollowUpAt !== null;
          const shouldFillLastActivity =
            existingCompanyPipeline.lastActivityAt === null;
          const shouldUpdatePipeline =
            existingCompanyPipeline.stage !== company.stage ||
            existingCompanyPipeline.notes !== company.pipelineNotes ||
            shouldFillNextFollowUp ||
            shouldFillLastActivity;

          if (shouldUpdatePipeline) {
            await tx
              .update(pipeline)
              .set({
                stage: company.stage,
                notes: company.pipelineNotes,
                ...(shouldFillNextFollowUp ? { nextFollowUpAt } : {}),
                ...(shouldFillLastActivity ? { lastActivityAt } : {}),
              })
              .where(
                and(
                  eq(pipeline.id, pipelineId),
                  eq(pipeline.organizationId, demoOrganizationId),
                ),
              );
            updatedPipelineRows += 1;
          }
        }
      }

      for (const contact of contactSeeds) {
        const contactValues = {
          companyId: contact.companyId,
          apolloId: contact.apolloId,
          name: contact.name,
          title: contact.title,
          email: contact.email,
          linkedin: contact.linkedin,
          notes: contact.notes,
        };
        const existingContact = existingContacts.get(contact.id);

        if (!existingContact) {
          const insertedContactRows = await tx
            .insert(contacts)
            .values({
              id: contact.id,
              organizationId: demoOrganizationId,
              ...contactValues,
            })
            .onConflictDoNothing()
            .returning({ id: contacts.id });

          insertedContacts += insertedContactRows.length;
        } else if (
          existingContact.companyId !== contactValues.companyId ||
          existingContact.apolloId !== contactValues.apolloId ||
          existingContact.name !== contactValues.name ||
          existingContact.title !== contactValues.title ||
          existingContact.email !== contactValues.email ||
          existingContact.linkedin !== contactValues.linkedin ||
          existingContact.notes !== contactValues.notes
        ) {
          await tx
            .update(contacts)
            .set(contactValues)
            .where(
              and(
                eq(contacts.id, contact.id),
                eq(contacts.organizationId, demoOrganizationId),
              ),
            );
          updatedContacts += 1;
        }

        const pipelineId = `50000000-0000-4000-8000-${contact.id.slice(-12)}`;
        const nextFollowUpAt =
          contact.nextFollowUpInDays === null
            ? null
            : fromNow(contact.nextFollowUpInDays);
        const lastActivityAt = fromNow(-contact.lastActivityDaysAgo);
        const existingContactPipeline = existingPipeline.get(pipelineId);

        if (!existingContactPipeline) {
          const insertedPipelineRowsForContact = await tx
            .insert(pipeline)
            .values({
              id: pipelineId,
              organizationId: demoOrganizationId,
              contactId: contact.id,
              stage: contact.stage,
              nextFollowUpAt,
              lastActivityAt,
              notes: contact.pipelineNotes,
            })
            .onConflictDoNothing()
            .returning({ id: pipeline.id });

          insertedPipelineRows += insertedPipelineRowsForContact.length;
        } else {
          const shouldFillNextFollowUp =
            existingContactPipeline.nextFollowUpAt === null &&
            nextFollowUpAt !== null;
          const shouldFillLastActivity =
            existingContactPipeline.lastActivityAt === null;
          const shouldUpdatePipeline =
            existingContactPipeline.stage !== contact.stage ||
            existingContactPipeline.notes !== contact.pipelineNotes ||
            shouldFillNextFollowUp ||
            shouldFillLastActivity;

          if (shouldUpdatePipeline) {
            await tx
              .update(pipeline)
              .set({
                stage: contact.stage,
                notes: contact.pipelineNotes,
                ...(shouldFillNextFollowUp ? { nextFollowUpAt } : {}),
                ...(shouldFillLastActivity ? { lastActivityAt } : {}),
              })
              .where(
                and(
                  eq(pipeline.id, pipelineId),
                  eq(pipeline.organizationId, demoOrganizationId),
                ),
              );
            updatedPipelineRows += 1;
          }
        }
      }
    });

    console.log(
      `Lead demo seed complete: inserted ${insertedCompanies}/${companySeeds.length} companies, updated ${updatedCompanies}; inserted ${insertedContacts}/${contactSeeds.length} contacts, updated ${updatedContacts}; inserted ${insertedPipelineRows}/${companySeeds.length + contactSeeds.length} pipeline records, updated ${updatedPipelineRows}.`,
    );
  } finally {
    await client.end();
  }
}

seed()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
