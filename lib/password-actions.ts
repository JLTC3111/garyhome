import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDeadline } from "./requests.ts";

// This unverified subject only binds the form to the email link's intended
// identity. The SDK session and Auth API still verify every password write.
export function emailLinkIdentity(hash: string, expectedType: "invite" | "recovery"): string | null {
  try {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    if (params.get("type") !== expectedType) return null;
    const token = params.get("access_token")?.split(".");
    if (!token || token.length !== 3) return null;
    const payload = JSON.parse(atob(token[1].replaceAll("-", "+").replaceAll("_", "/")));
    return typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null;
  } catch { return null; }
}

// Freeze the JWT: auth.updateUser() can pick up a different account's session
// if a tab switches accounts while a password request is being prepared.
export async function setAccountPassword(client: SupabaseClient, userId: string, password: string, signal: AbortSignal) {
  const { data, error } = await client.auth.getSession();
  const session = data.session;
  if (error || !session || session.user.id !== userId) throw new Error("Your account changed. Open the email link again before continuing.");
  const frozenToken = session.access_token;
  const response = await fetchWithDeadline("/api/config", { cache: "no-store", signal });
  if (!response.ok) throw new Error("Reconnect before updating your password.");
  const config = await response.json() as { configured: boolean; url: string; publishableKey: string };
  if (!config.configured || !config.url || !config.publishableKey) throw new Error("Reconnect before updating your password.");
  signal.throwIfAborted();
  const result = await fetchWithDeadline(config.url + "/auth/v1/user", {
    method: "PUT", signal,
    headers: { apikey: config.publishableKey, Authorization: "Bearer " + frozenToken, "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!result.ok) throw new Error(result.status === 401 || result.status === 403
    ? "This link has expired. Request a new email link before continuing."
    : "Couldn’t update the password. Check the password requirements and try again.");
}
