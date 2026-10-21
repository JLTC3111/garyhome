import { backendConfig } from "@/lib/server";
export async function GET() {
  const { url, key } = backendConfig();
  return Response.json({ url, publishableKey: key, configured: !!(url && key) }, { headers: { "Cache-Control": "no-store" } });
}
