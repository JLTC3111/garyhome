import { requireAvailableContent } from "@/lib/content-unavailable";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { RentalGuidePage } from "@/components/about-sections";
import { publicArticles, editorialView } from "@/lib/editorial";
import { guideMetadata,siteUrl,loadPageContent } from "@/lib/seo";
import { languageValue } from "@/lib/language";
export async function generateMetadata({params}:{params:Promise<{slug:string}>}){return guideMetadata((await params).slug);}
export default async function Page({params}:{params:Promise<{slug:string}>}){
 const {slug}=await params,{content}=requireAvailableContent(await loadPageContent()),record=publicArticles(content.editorial).find(item=>item.slug===slug);if(!record)notFound();const article=editorialView(record);
 const language=languageValue((await cookies()).get("gary-language")?.value),i=language==="vi"?1:0;
 const structured={"@context":"https://schema.org","@type":"Article",headline:article.title[i],description:article.summary[i],inLanguage:language==="vi"?"vi-VN":"en",mainEntityOfPage:siteUrl()+"/tips-and-news/"+slug,publisher:{"@type":"Organization",name:"Gary Home"},...("published" in article?{datePublished:String(article.published)+"T00:00:00+07:00"}:{}),...("image" in article?{image:new URL(String(article.image),siteUrl()).href}:{})};
 return <><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(structured).replaceAll("<","\\u003c")}}/><RentalGuidePage slug={slug} articles={content.editorial}/></>;
}
