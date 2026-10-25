import { LandlordsPage } from "@/components/about-sections";
import { pageMetadata } from "@/lib/seo";
export async function generateMetadata(){return pageMetadata("/landlords");}
export default function Page(){return <LandlordsPage/>;}
