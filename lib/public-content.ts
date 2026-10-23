import type { SupabaseClient } from "@supabase/supabase-js";
import type { Content } from "./types";
import { contentAssets } from "./content-assets.ts";
import { propertyOrders } from "./property-order.ts";
import { request } from "./requests.ts";

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
    const [properties, neighbourhoods, settings, authors, activities, orders] = await Promise.all([
      db.from("properties").select("*").eq("status", "published").eq("listing_type","rent").in("availability",["available","on_request"]).order("sort_order").abortSignal(signal),
      db.from("neighbourhoods").select("*").order("sort_order").abortSignal(signal),
      db.from("site_settings").select("*").eq("id", "main").abortSignal(signal).single(),
      db.from("listing_authors").select("*").eq("published",true).order("sort_order").abortSignal(signal),
      db.from("site_activities").select("*").eq("published",true).order("sort_order").abortSignal(signal),
      db.from("property_display_orders").select("scope,property_ids").abortSignal(signal),
    ]);
    for (const [resource, result] of [["properties", properties], ["neighbourhoods", neighbourhoods], ["site_settings", settings], ["listing_authors",authors], ["site_activities",activities],["property_display_orders",orders]] as const) {
      if (result.error) throw new ContentReadError(resource, result.status, result.error.code);
    }
    if (!Array.isArray(properties.data) || !Array.isArray(neighbourhoods.data) || !settings.data) {
      throw new ContentReadError("response", 200, "INVALID_CONTENT");
    }
    return contentAssets({ properties: properties.data, neighbourhoods: neighbourhoods.data, settings: settings.data, authors: authors.data||[], activities: activities.data||[],propertyOrders:propertyOrders(orders.data) } as Content);
  }, 12000);
}
