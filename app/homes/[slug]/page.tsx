import { requireAvailableContent } from "@/lib/content-unavailable";
import { notFound } from "next/navigation";
import { loadPageContent,propertyMetadata,propertyStructuredData,requestLanguage } from "@/lib/seo";
import { isPublicRental } from "@/lib/rentals";
import { PropertyDetail } from "@/components/property-detail";
export async function generateMetadata({params}:{params:Promise<{slug:string}>}){return propertyMetadata((await params).slug);}
export default async function Page({params}:{params:Promise<{slug:string}>}){const {slug}=await params,{content}=requireAvailableContent(await loadPageContent()),language=await requestLanguage(),p=content.properties.find(p=>p.slug===slug&&isPublicRental(p));if(!p)notFound();return <>{p&&<script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(propertyStructuredData(p,language,content.neighbourhoods.find(n=>n.slug===p.district_slug)?.name)).replace(/</g,"\\u003c")}}/>}<PropertyDetail slug={slug} property={p} neighbourhood={content.neighbourhoods.find(n=>n.slug===p.district_slug)}/></>;}
