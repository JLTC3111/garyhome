import { z } from "zod";
import { readJsonBody, BodyReadError } from "@/lib/request-body";
import { request as boundedRequest } from "@/lib/requests";
import { StaffRequestError, staffRequest } from "@/lib/staff-server";
import { auditDatabase, startAudit, advanceAudit } from "@/lib/seo-audit/service";
import { auditSnapshot, updateAuditSettings } from "@/lib/seo-audit/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const uuid = z.string().uuid();
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), url: z.string().trim().min(1).max(2048).optional() }),
  z.object({ action: z.literal("advance"), runId: uuid }),
]);
const settingsInput = z.object({ weeklyEnabled: z.boolean(), limits: z.object({
  maxUrls: z.number().int().min(1).max(500), maxDepth: z.number().int().min(0).max(4),
  concurrency: z.number().int().min(1).max(2), requestIntervalMs: z.number().int().min(1000).max(60000),
  timeoutMs: z.number().int().min(1000).max(10000), maxDurationMs: z.number().int().min(10000).max(900000),
}) });
async function authorize(request: Request, manage = false) {
  return boundedRequest(signal => staffRequest(request, signal, manage ? "manage" : "view"), 15000);
}
function failure(error: unknown) {
  const status = error instanceof StaffRequestError || error instanceof BodyReadError ? error.status : error instanceof z.ZodError || error instanceof TypeError ? 400 : 503;
  // Error messages from the store/service are deliberately credential-free.
  return Response.json({ error: error instanceof z.ZodError ? "Check the SEO audit options and crawl limits." : error instanceof Error ? error.message : "SEO audit unavailable. Refresh before trying again." }, { status, headers });
}
export async function GET(request: Request) {
  try {
    await authorize(request);
    const runId = new URL(request.url).searchParams.get("runId") || undefined;
    if (runId) uuid.parse(runId);
    return Response.json(await auditSnapshot(auditDatabase(), runId), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const { user } = await authorize(request);
    const selectedId = new URL(request.url).searchParams.get("runId");
    if (selectedId) uuid.parse(selectedId);
    const input = command.parse(await readJsonBody(request, 4096));
    let runId: string | undefined;
    if (input.action === "start") {
      const run = await startAudit(input.url ? "page" : "manual", user.id, input.url);
      runId = run?.id;
    } else { runId = input.runId; await advanceAudit(runId); }
    return Response.json(await auditSnapshot(auditDatabase(), selectedId || runId), { headers });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    await authorize(request, true);
    const selectedId = new URL(request.url).searchParams.get("runId") || undefined;
    if (selectedId) uuid.parse(selectedId);
    const input = settingsInput.parse(await readJsonBody(request, 4096));
    await updateAuditSettings(auditDatabase(), input);
    return Response.json(await auditSnapshot(auditDatabase(), selectedId), { headers });
  } catch (error) { return failure(error); }
}
