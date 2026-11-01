import type { SupabaseClient } from "@supabase/supabase-js";
import type { Content } from "./types";
import { contentAssets } from "./content-assets.ts";
import { propertyOrders } from "./property-order.ts";
import { request } from "./requests.ts";
import { readAllRows } from "./pagination.ts";

export class ContentReadError extends Error {
  readonly resource: string;
  readonly status: number;
  readonly code: string;
  constructor(resource: string, status: number, code: string) {
    super("Public content unavailable");
    this.name = "ContentReadError";
    this.resource = resource;
    this.status = status;
    this.code = code;
  }
}

// Use an anonymous client for these reads, including in the browser. A Studio
// session must never turn the public fallback cache into a cache of draft homes.
export async function readPublishedContent(db: SupabaseClient, upstream?: AbortSignal): Promise<Content> {
  return request(async deadline => {
    const signal = upstream ? AbortSignal.any([upstream, deadline]) : deadline;
    async function list<T>(resource: string, query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code: string } | null; status: number }>) {
      const data = await readAllRows(async (from, to) => {
        const result = await query(from, to);
        if (result.error) throw new ContentReadError(resource, result.status, result.error.code);
        return result;
      });
      return { data, error: null };
    }
    const [properties, neighbourhoods, settings, authors, activities, orders, articles] = await Promise.all([
      list("properties", (from,to) => db.from("properties").select("*").eq("status", "published").eq("listing_type","rent").in("availability",["available","on_request"]).order("sort_order").order("id").range(from,to).abortSignal(signal)),
      list("neighbourhoods", (from,to) => db.from("neighbourhoods").select("*").order("sort_order").order("slug").range(from,to).abortSignal(signal)),
      db.from("site_settings").select("*").eq("id", "main").abortSignal(signal).single(),
      list("listing_authors", (from,to) => db.from("listing_authors").select("*").eq("published",true).order("sort_order").order("id").range(from,to).abortSignal(signal)),
      list("site_activities", (from,to) => db.from("site_activities").select("*").eq("published",true).order("sort_order").order("id").range(from,to).abortSignal(signal)),
      list("property_display_orders", (from,to) => db.from("property_display_orders").select("scope,property_ids").order("scope").range(from,to).abortSignal(signal)),
      list("editorial_articles", (from,to) => db.from("editorial_articles").select("*").eq("status","published").order("published_on",{ascending:false,nullsFirst:false}).order("id").range(from,to).abortSignal(signal)),
    ]);
    if (settings.error) throw new ContentReadError("site_settings", settings.status, settings.error.code);
    if (!Array.isArray(properties.data) || !Array.isArray(neighbourhoods.data) || !settings.data) {
      throw new ContentReadError("response", 200, "INVALID_CONTENT");
    }
    return contentAssets({ editorial:articles.data||[], properties: properties.data, neighbourhoods: neighbourhoods.data, settings: settings.data, authors: authors.data||[], activities: activities.data||[],propertyOrders:propertyOrders(orders.data) } as Content);
  }, 12000);
}
