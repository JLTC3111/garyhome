// Default server runtime for Next.js on Vercel and other Node hosts.
// The Sites/Vite build aliases this module to runtime-env.cloudflare.ts.
export const runtimeEnv: Record<string, string | undefined> = process.env;
