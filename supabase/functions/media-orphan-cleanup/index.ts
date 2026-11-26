import { createMediaCleanup } from "./worker.mjs";

Deno.serve(createMediaCleanup({
  url: Deno.env.get("SUPABASE_URL"),
  publishable: Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY"),
  service: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  cronSecret: Deno.env.get("HOME_MEDIA_CRON_SECRET"),
}));
