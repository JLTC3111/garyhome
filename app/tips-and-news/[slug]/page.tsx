import { notFound } from "next/navigation";
import { RentalGuidePage } from "@/components/about-sections";
import { rentalGuides } from "@/lib/rental-guides";
import { guideMetadata } from "@/lib/seo";
export async function generateMetadata({params}:{params:Promise<{slug:string}>}){return guideMetadata((await params).slug);}
export default async function Page({params}:{params:Promise<{slug:string}>}){const {slug}=await params;if(!rentalGuides.some(item=>item.slug===slug))notFound();return <RentalGuidePage slug={slug}/>;}
