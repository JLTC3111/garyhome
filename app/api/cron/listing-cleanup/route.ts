import { timingSafeEqual } from "node:crypto";
import { backendConfig, staffAdminClient } from "@/lib/server";
import { runtimeEnv } from "@/lib/runtime-env";
import { request } from "@/lib/requests";
import { LISTING_VIDEO_ORIGIN } from "@/lib/property-video";
import { retryDueListingCleanup } from "@/lib/property-deletion-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = {"Cache-Control":"private, no-store"};

export async function POST(req: Request) {
  const expected=Buffer.from(runtimeEnv.LISTING_CLEANUP_CRON_SECRET || "");
  const supplied=Buffer.from(req.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1] || "");
  if (!expected.length || supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) {
    return Response.json({error:"Unauthorized."},{status:401,headers});
  }
  try {
    const db=staffAdminClient();
    if(!db||new URL(backendConfig().url).origin!==LISTING_VIDEO_ORIGIN)throw new Error("Unavailable");
    const result=await request(signal=>retryDueListingCleanup(db,AbortSignal.any([req.signal,signal])),40000);
    return Response.json(result,{headers});
  } catch {
    return Response.json({error:"Listing cleanup is temporarily unavailable."},{status:503,headers});
  }
}
