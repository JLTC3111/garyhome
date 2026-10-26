import { loadContent } from "@/lib/server";
import { siteUrl } from "@/lib/seo";
import { isPublicRental } from "@/lib/rentals";
import { editorialArticles } from "@/lib/rental-guides";
export default async function sitemap(){const {content}=await loadContent();const base=siteUrl();return ["","/homes","/neighbourhoods","/services","/tips-and-news","/landlords","/contact","/activities","/feedback"].map(path=>({url:base+path})).concat(editorialArticles.map(guide=>({url:base+"/tips-and-news/"+guide.slug}))).concat(content.properties.filter(isPublicRental).map(p=>({url:base+"/homes/"+p.slug})));}
