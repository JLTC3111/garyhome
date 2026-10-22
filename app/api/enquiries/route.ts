import { z } from "zod";
import { publicSupabase } from "@/lib/server";

const enquiry = z.object({
  name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254),
  phone: z.string().trim().max(40).default(""), message: z.string().trim().min(10).max(4000),
  property_id: z.string().uuid().nullable().default(null),
  preferred_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  kind: z.enum(["viewing", "general", "landlord"]).default("general"), consent: z.literal(true),
  website: z.string().max(0).optional(),
});
// Best-effort abuse protection per server instance, in addition to database validation.
const requests = new Map<string, number[]>();
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Invalid origin." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 16000) return Response.json({ error: "Request too large." }, { status: 413 });
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer (\S+)$/i)?.[1];
  if (authorization && !token) return Response.json({ error: "Please sign in again before sending this request." }, { status: 401 });
  const db = publicSupabase(token);
  if (!db) return Response.json({ error: "Online requests are not connected yet. Please call or email the team." }, { status: 503 });
  if (token) {
    try {
      const { data, error } = await db.auth.getUser(token);
      if (error || !data.user) return Response.json({ error: "Please sign in again before sending this request." }, { status: 401 });
    } catch { return Response.json({ error: "Couldn’t verify your account. Reconnect before sending this request." }, { status: 503 }); }
  }
  let input: unknown;
  try { const body = await request.text(); if (body.length > 16000) throw new Error(); input = JSON.parse(body); }
  catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = enquiry.safeParse(input);
  if (!parsed.success) return Response.json({ error: "Please check your name, email, message, and consent." }, { status: 400 });
  const date = parsed.data.preferred_date;
  if (date && (date < new Date().toISOString().slice(0, 10) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) return Response.json({ error: "Choose a valid future viewing date." }, { status: 400 });
  // Use the hosting platform's trusted header. On Vercel, a client-supplied
  // Cloudflare header must not choose the rate-limit bucket.
  const ip = (process.env.VERCEL === "1"
    ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    : request.headers.get("cf-connecting-ip")) || "local";
  const now = Date.now();
  for (const [key, times] of requests) if (times.every(t => now - t > 600000)) requests.delete(key);
  const recent = (requests.get(ip) || []).filter(t => now - t < 600000);
  if (recent.length >= 5) return Response.json({ error: "Please wait a few minutes before sending another request." }, { status: 429 });
  requests.set(ip, [...recent, now]);
  const record = parsed.data;
  delete record.website;
  const { error } = await db.from("enquiries").insert(record);
  if (error) return Response.json({ error: "We couldn’t save your request. Please try again or contact the team directly." }, { status: 500 });
  return Response.json({ ok: true }, { status: 201 });
}
