// Cloudflare bindings are request/runtime supplied, rather than build-time values.
export { env as runtimeEnv } from "cloudflare:workers";
export const seoAuditTransport = "trusted-fetch" as const;
