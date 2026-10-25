import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDeadline } from "./requests.ts";

export type PasswordLink={type:"invite"|"recovery";userId:string};
export type EmailLinkIssue="expired"|"invalid";
export type EmailTokenLink={type:PasswordLink["type"];tokenHash:string};
export function emailTokenLink(hash:string,search=""):EmailTokenLink|null{
  for(const source of [hash.replace(/^#/,""),search.replace(/^\?/,"")]){
    const params=new URLSearchParams(source),type=params.get("type"),tokenHash=params.get("token_hash");
    if((type==="invite"||type==="recovery")&&tokenHash&&/^[a-zA-Z0-9_-]{16,512}$/.test(tokenHash))return {type,tokenHash};
  }
  return null;
}
export function emailLinkIssue(hash:string,search=""):EmailLinkIssue|null{
  for(const source of [hash.replace(/^#/,""),search.replace(/^\?/,"")]){
    const params=new URLSearchParams(source);
    if(params.get("error_code")==="otp_expired")return "expired";
    if(params.has("error")||params.has("error_code")||params.has("error_description"))return "invalid";
    if(params.has("token_hash")&&!emailTokenLink(hash,search))return "invalid";
  }
  return null;
}
export function passwordLinkEvidence(hash:string):PasswordLink|null{
  for(const type of ["invite","recovery"] as const){const userId=emailLinkIdentity(hash,type);if(userId)return {type,userId};}
  return null;
}

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
