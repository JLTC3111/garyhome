import { notFound } from "next/navigation";
import { loadContent } from "@/lib/server";
import { PropertyDetail } from "@/components/property-detail";
export async function generateMetadata({ params }: { params: Promise<{slug:string}> }) {
  const {slug}=await params;const {content}=await loadContent();const p=content.properties.find(p=>p.slug===slug);
  return {title:p?.title_en||"Home not found",description:p?.description_en,openGraph:p?{images:[{url:p.images[0]}]}:undefined};
}
export default async function Page({params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params;
  return <PropertyDetail slug={slug}/>;
}
