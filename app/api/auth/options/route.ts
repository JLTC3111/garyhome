import { backendConfig, publicSupabase } from "@/lib/server";
import { fetchWithDeadline, request } from "@/lib/requests";

export async function GET() {
  const { url, key } = backendConfig();
  if (!url || !key) return Response.json({ available: false, google: false, apple: false, email: false }, { headers: { "Cache-Control": "no-store" } });
  try {
    const [response, domain] = await request(signal => Promise.all([
      fetchWithDeadline(url + "/auth/v1/settings", { headers: { apikey: key }, signal }, 8000),
      publicSupabase()!.from("staff_settings").select("email_domains").eq("id", "main").abortSignal(signal).maybeSingle(),
    ]), 9000);
    if (!response.ok) throw new Error();
    const settings = await response.json() as { external?: Record<string, boolean>; disable_signup?: boolean };
    return Response.json({ available: true, google: settings.external?.google === true, apple: settings.external?.apple === true, email: settings.external?.email === true, signup: settings.disable_signup !== true, staffDomains: domain.data?.email_domains ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ available: false, google: false, apple: false, email: true }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
