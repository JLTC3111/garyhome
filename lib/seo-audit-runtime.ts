// Keep this import identical to lib/server.ts so the existing Vite runtime
// alias replaces it on Cloudflare. Node's DNS-pinning lookup is unsupported in
// Workers; only explicitly configured origins may use Workers' fetch transport.
import { seoAuditTransport } from "./runtime-env";
export function auditNetworkOptions() {
  return (seoAuditTransport as string) === "trusted-fetch"
    ? { transportMode: "trusted-fetch" as const, fetch: globalThis.fetch.bind(globalThis) }
    : { transportMode: "pinned" as const };
}
