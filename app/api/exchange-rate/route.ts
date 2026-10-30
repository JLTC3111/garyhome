import { getExchangeRate } from "@/lib/exchange-rate-server";

export async function GET() {
  const rate = await getExchangeRate();
  return Response.json({ rate, ...(!rate && process.env.NODE_ENV === "development" ? { diagnostic: getExchangeRate.diagnostics() } : {}) }, { status: rate ? 200 : 503, headers: {
    "Cache-Control": rate ? "public, max-age=300, s-maxage=300" : "public, max-age=60",
    "X-Content-Type-Options": "nosniff",
  } });
}
