import { getHealthSnapshot } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getHealthSnapshot();

  return Response.json(health, {
    status: health.status === "unhealthy" ? 503 : 200,
    headers: {
      "cache-control": "no-store",
    },
  });
}
