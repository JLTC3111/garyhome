import type { SupabaseClient } from "@supabase/supabase-js";
import type { Content, Property } from "./types";
import { contentAssets } from "./content-assets.ts";
import { propertyOrders } from "./property-order.ts";
import { request } from "./requests.ts";
import { firstPageCount, readAllRows } from "./pagination.ts";
import { unlocalizedPath } from "./localized-routes.ts";

const cataloguePaths = new Set(["/","/homes","/vinhomes","/neighbourhoods","/saved","/cart","/account","/sitemap.xml"]);

export function publicContentPath(pathname: string) {
  const path = unlocalizedPath(pathname).replace(/\/+$/, "") || "/";
  return cataloguePaths.has(path) || path === "/activities" || path === "/tips-and-news"
    || /^\/(homes|tips-and-news)\/[a-z0-9-]+$/.test(path) ? path : "/shell";
}

function publicProperties(db: SupabaseClient, columns = "*", from = -1) {
  return db.from("home_public_properties").select(columns,firstPageCount(from)).eq("status","published")
    .eq("listing_type","rent").in("availability",["available","on_request"]).order("sort_order").order("id");
}

export async function readSavedPublicProperties(db: SupabaseClient, ids: string[], signal: AbortSignal) {
  ids = ids.filter(id=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id));
  const properties: Property[] = [];
  for (let index = 0; index < ids.length; index += 50) {
    const batch = ids.slice(index,index+50);
    properties.push(...await readAllRows(async (from,to)=>{
      const result = await publicProperties(db,"*",from).in("id",batch).range(from,to).abortSignal(signal);
      if (result.error) throw new ContentReadError("properties",result.status,result.error.code);
      return {data:result.data as unknown as Property[],error:null,count:result.count};
    },50));
  }
  return properties;
}

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
export async function readPublishedContent(db: SupabaseClient, upstream?: AbortSignal, scope?: string): Promise<Content> {
  return request(async deadline => {
    const signal = upstream ? AbortSignal.any([upstream, deadline]) : deadline;
    const path = scope && publicContentPath(scope);
    const propertySlug = path?.startsWith("/homes/") ? path.slice("/homes/".length) : "";
    const articleSlug = path?.startsWith("/tips-and-news/") ? path.slice("/tips-and-news/".length) : "";
    const sitemap = path === "/sitemap.xml";
    const catalogue = !path || cataloguePaths.has(path);
    const activitiesNeeded = !path || path === "/" || path === "/activities";
    const articlesNeeded = !path || sitemap || path === "/tips-and-news" || !!articleSlug;
    const empty = {data:[],error:null};
    async function list<T>(resource: string, query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code: string } | null; status: number; count?: number | null }>) {
      const data = await readAllRows(async (from, to) => {
        const result = await query(from, to);
        if (result.error) throw new ContentReadError(resource, result.status, result.error.code);
        return result;
      });
      return { data, error: null };
    }
    async function detailProperties() {
      const row = await publicProperties(db).eq("slug",propertySlug).abortSignal(signal).maybeSingle();
      if (row.error) throw new ContentReadError("properties",row.status,row.error.code);
      if (!row.data) return empty;
      const property = row.data as unknown as Property;
      const related = await publicProperties(db).eq("district_slug",property.district_slug).neq("id",property.id).limit(3).abortSignal(signal);
      if (related.error) throw new ContentReadError("properties",related.status,related.error.code);
      return {data:[property,...(related.data ?? [])],error:null};
    }
    const [properties, neighbourhoods, settings, authors, activities, orders, articles] = await Promise.all([
      propertySlug ? detailProperties() : catalogue
        ? list("properties", (from,to) => publicProperties(db,sitemap?"id,slug,status,listing_type,availability,images,sort_order":"*",from).range(from,to).abortSignal(signal)) : empty,
      list("neighbourhoods", (from,to) => db.from("neighbourhoods").select("*",firstPageCount(from)).order("sort_order").order("slug").range(from,to).abortSignal(signal)),
      db.from("site_settings").select("*").eq("id", "main").abortSignal(signal).single(),
      (!path || catalogue && !sitemap || propertySlug) ? list("listing_authors", (from,to) => db.from("listing_authors").select("*",firstPageCount(from)).eq("published",true).order("sort_order").order("id").range(from,to).abortSignal(signal)) : empty,
      activitiesNeeded ? list("site_activities", (from,to) => db.from("site_activities").select("*",firstPageCount(from)).eq("published",true).order("sort_order").order("id").range(from,to).abortSignal(signal)) : empty,
      (!path || ["/","/homes","/saved","/cart"].includes(path)) ? list("property_display_orders", (from,to) => db.from("property_display_orders").select("scope,property_ids",firstPageCount(from)).order("scope").range(from,to).abortSignal(signal)) : empty,
      articlesNeeded ? list("editorial_articles", (from,to) => {
        let query = db.from("editorial_articles").select(sitemap?"id,slug,status,published_on,created_at":"*",firstPageCount(from)).eq("status","published");
        if (articleSlug) query = query.eq("slug",articleSlug);
        return query.order("published_on",{ascending:false,nullsFirst:false}).order("id").range(from,to).abortSignal(signal);
      }) : empty,
    ]);
    if (settings.error) throw new ContentReadError("site_settings", settings.status, settings.error.code);
    if (!Array.isArray(properties.data) || !Array.isArray(neighbourhoods.data) || !settings.data) {
      throw new ContentReadError("response", 200, "INVALID_CONTENT");
    }
    return contentAssets({ editorial:articles.data||[], properties: properties.data, neighbourhoods: neighbourhoods.data, settings: settings.data, authors: authors.data||[], activities: activities.data||[],propertyOrders:propertyOrders(orders.data) } as Content);
  }, 12000);
}
