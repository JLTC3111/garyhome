import { localizedAlternates, localizedPath } from "@/lib/localized-routes";
import { PUBLIC_LANDING_PATHS } from "@/lib/public-routes";
import { loadContent } from "@/lib/server";
import { siteUrl } from "@/lib/seo";
import { isPublicRental } from "@/lib/rentals";
import { publicArticles } from "@/lib/editorial";
import { requireAvailableContent } from "@/lib/content-unavailable";
export const dynamic="force-dynamic";
export default async function sitemap(){
 const {content}=requireAvailableContent(await loadContent()),base=siteUrl();
 const paths=[...PUBLIC_LANDING_PATHS,...publicArticles(content.editorial).map(guide=>"/tips-and-news/"+guide.slug),...content.properties.filter(isPublicRental).map(p=>"/homes/"+p.slug)];
 return paths.flatMap(path=>(["en","vi"] as const).map(language=>({url:new URL(localizedPath(path,language),base).href,alternates:{languages:localizedAlternates(path,base,language).languages}})));
}
