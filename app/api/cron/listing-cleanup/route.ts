import { timingSafeEqual } from "node:crypto";
import { runtimeEnv } from "@/lib/runtime-env";

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
  return Response.json({error:"Schedule the Gary Home media-orphan-cleanup function."},{status:410,headers});
}
