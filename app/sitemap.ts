import { loadContent } from "@/lib/server";
import { siteUrl } from "@/lib/seo";
import { isPublicRental } from "@/lib/rentals";
export default async function sitemap(){const {content}=await loadContent();const base=siteUrl();return ["","/homes","/neighbourhoods","/about","/contact","/activities","/feedback"].map(path=>({url:base+path})).concat(content.properties.filter(isPublicRental).map(p=>({url:base+"/homes/"+p.slug})));}
