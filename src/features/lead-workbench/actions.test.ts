import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.hoisted(() => vi.fn(async () => undefined));
const createEventMock = vi.hoisted(() =>
  vi.fn((data: Record<string, unknown>) => ({
    name: "lead.ingest.requested",
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
}));

vi.mock("./server/context", () => ({ requireLeadContext: contextMock }));

import { triggerDomainIngestion } from "./actions";
import { importCompaniesCsv } from "./server/actions";

describe("triggerDomainIngestion", () => {
  beforeEach(() => {
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

  it("returns a useful parse error for malformed CSV before opening a database transaction", async () => {
    const result = await importCompaniesCsv('name\n"Unterminated');

    expect(result).toEqual({
      ok: false,
      error: "CSV contains an unterminated quoted field.",
    });
  });
});
