import { staffAdminClient } from "./server";
import { request as boundedRequest } from "./requests";

export async function savePublicIntake(request: Request, channel: "enquiry" | "feedback" | "assistance", details: Record<string, unknown>, userId: string | null) {
  const admin = staffAdminClient();
  if (!admin) return { data: null, error: { code: "UNAVAILABLE" } };
  const ip = (process.env.VERCEL === "1"
    ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    : request.headers.get("cf-connecting-ip")) || "local";
  // Quotas store an opaque digest, never a raw visitor address.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("GaryHome/intake/v1/" + ip));
  const clientKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return boundedRequest(signal => admin.rpc("submit_public_intake", {
    channel, client_key: clientKey, verified_user: userId, details,
  }).abortSignal(signal));
}
