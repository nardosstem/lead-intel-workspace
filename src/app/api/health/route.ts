import { getHealthSnapshot } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getHealthSnapshot();

  // Keep provider presence, kill switches, and database diagnostics out of a
  // public endpoint. Deploy monitors only need liveness/readiness status; the
  // full snapshot remains available to server-side operational tooling.
  const publicHealth = {
    status: health.status,
    checks: { database: health.checks.database },
  } as const;

  return Response.json(publicHealth, {
    status: health.status === "ok" ? 200 : 503,
    headers: {
      "cache-control": "no-store",
    },
  });
}
