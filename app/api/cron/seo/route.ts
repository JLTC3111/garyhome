import { timingSafeEqual } from "node:crypto";
import { runtimeEnv } from "@/lib/runtime-env";
import { advanceAudit, auditDatabase, startAudit } from "@/lib/seo-audit/service";
import { auditSnapshot } from "@/lib/seo-audit/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
// The scheduled runner repeats this bounded operation until the persisted job
// completes. It never needs a staff session or access to the database secret.
export async function POST(request: Request) {
  const secret = runtimeEnv.CRON_SECRET;
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1] || "";
  const supplied = Buffer.from(token), expected = Buffer.from(secret || "");
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return Response.json({ error: "Unauthorized." }, { status: 401, headers });
  try {
    await startAudit("weekly");
    await advanceAudit();
    const { activeRun } = await auditSnapshot(auditDatabase());
    return Response.json({ active: !!activeRun, runId: activeRun?.id || null }, { headers });
  } catch {
    return Response.json({ error: "Scheduled SEO audit failed. Check the Studio audit report and server configuration." }, { status: 503, headers });
  }
}
