import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.hoisted(() => vi.fn(async () => undefined));
const createEventMock = vi.hoisted(() =>
  vi.fn((data: Record<string, unknown>) => ({
    name: "lead.ingest.requested",
    data,
    validate: vi.fn(async () => undefined),
  })),
);
const newsCreateEventMock = vi.hoisted(() =>
  vi.fn((data: Record<string, unknown>) => ({
    name: "lead.news.scan.requested",
    data,
    validate: vi.fn(async () => undefined),
  })),
);
const contextMock = vi.hoisted(() =>
  vi.fn(async () => ({
    organizationId: "10000000-0000-4000-8000-000000000001",
    userId: "10000000-0000-4000-8000-000000000002",
  })),
);

vi.mock("@/inngest/client", () => ({
  inngest: { send: sendMock },
  leadIngestRequested: { create: createEventMock },
  newsScanRequested: { create: newsCreateEventMock },
}));

vi.mock("./server/context", () => ({ requireLeadContext: contextMock }));

import { triggerDomainIngestion, triggerNewsScan } from "./actions";
import {
  createCompany,
  createContact,
  deleteCompany,
  deleteContact,
  importCompaniesCsv,
  inviteMember,
  revokeInvitation,
  updateCompany,
  updateContact,
  updateMemberRole,
  updateMemberStatus,
  updateLeadSignalStatus,
  updatePipeline,
  updateWorkspaceSettings,
} from "./server/actions";

describe("triggerDomainIngestion", () => {
  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.stubEnv("NEWS_SCAN_ENABLED", "1");
    sendMock.mockClear();
    createEventMock.mockClear();
    contextMock.mockClear();
  });

  it("rejects malformed domains before requiring auth or dispatching", async () => {
    const result = await triggerDomainIngestion("not a domain");

    expect(result).toEqual({
      ok: false,
      error: "Enter a valid domain such as stripe.com.",
    });
    expect(contextMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("dispatches a tenant-scoped event and normalizes the domain", async () => {
    const result = await triggerDomainIngestion("https://www.acme.com/pricing");

    expect(result).toEqual({
      ok: true,
      data: { message: "Ingestion started in background" },
    });
    expect(createEventMock).toHaveBeenCalledWith({
      domain: "acme.com",
      targetTitles: ["CEO", "Founder", "VP", "Director"],
      organizationId: "10000000-0000-4000-8000-000000000001",
      actorUserId: "10000000-0000-4000-8000-000000000002",
      runId: expect.any(String),
    });
    expect(sendMock).toHaveBeenCalledWith({
      name: "lead.ingest.requested",
      data: expect.objectContaining({ domain: "acme.com" }),
    });
  });

  it("honors the emergency ingestion kill switch before dispatching", async () => {
    vi.stubEnv("LEAD_INGESTION_ENABLED", "0");

    const result = await triggerDomainIngestion("acme.com");

    expect(result).toEqual({
      ok: false,
      error: "Lead ingestion is temporarily disabled by workspace configuration.",
    });
    expect(contextMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("dispatches an organization-scoped background news scan", async () => {
    const result = await triggerNewsScan();

    expect(result).toEqual({
      ok: true,
      data: { message: "News scan started in background" },
    });
    expect(newsCreateEventMock).toHaveBeenCalledWith({
      organizationId: "10000000-0000-4000-8000-000000000001",
      actorUserId: "10000000-0000-4000-8000-000000000002",
    });
    expect(sendMock).toHaveBeenCalledWith({
      name: "lead.news.scan.requested",
      data: expect.objectContaining({
        organizationId: "10000000-0000-4000-8000-000000000001",
      }),
    });
  });

  it("does not enqueue a news scan while the explicit opt-in is disabled", async () => {
    vi.stubEnv("NEWS_SCAN_ENABLED", "0");

    const result = await triggerNewsScan();

    expect(result).toEqual({
      ok: false,
      error: "News scanning is disabled. Set NEWS_SCAN_ENABLED=1 to enable it.",
    });
    expect(contextMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns a useful parse error for malformed CSV before opening a database transaction", async () => {
    const result = await importCompaniesCsv('name\n"Unterminated');

    expect(result).toEqual({
      ok: false,
      error: "CSV contains an unterminated quoted field.",
    });
  });

  it("rejects invalid lead and workspace mutation payloads at the action boundary", async () => {
    const results = await Promise.all([
      createCompany({ name: "" }),
      updateCompany({ id: "not-a-uuid", name: "Acme" }),
      deleteCompany("not-a-uuid"),
      createContact({ companyId: "not-a-uuid", name: "" }),
      updateContact({ id: "not-a-uuid", companyId: "not-a-uuid", name: "Contact" }),
      deleteContact("not-a-uuid"),
      updatePipeline({ id: "not-a-uuid", stage: "unknown", nextFollowUpAt: null }),
      updateWorkspaceSettings({ defaultStage: "unknown", followUpDays: 0 }),
      updateMemberRole({ targetUserId: "not-a-uuid", role: "member" }),
      updateMemberStatus({ targetUserId: "not-a-uuid", isActive: true }),
      updateLeadSignalStatus({ id: "not-a-uuid", status: "reviewed" }),
      inviteMember({ email: "not-an-email", role: "member" }),
      revokeInvitation("not-a-uuid"),
    ]);

    expect(results.every((result) => !result.ok)).toBe(true);
    expect(contextMock).not.toHaveBeenCalled();
  });
});
