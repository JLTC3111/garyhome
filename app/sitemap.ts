import { PUBLIC_LANDING_PATHS } from "@/lib/public-routes";
import { loadContent } from "@/lib/server";
import { siteUrl } from "@/lib/seo";
import { isPublicRental } from "@/lib/rentals";
import { publicArticles } from "@/lib/editorial";
import { requireAvailableContent } from "@/lib/content-unavailable";
export const dynamic="force-dynamic";
export default async function sitemap(){const {content}=requireAvailableContent(await loadContent());const base=siteUrl();return PUBLIC_LANDING_PATHS.map(path=>({url:new URL(path,base).href})).concat(publicArticles(content.editorial).map(guide=>({url:base+"/tips-and-news/"+guide.slug}))).concat(content.properties.filter(isPublicRental).map(p=>({url:base+"/homes/"+p.slug})));}
