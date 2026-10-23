import { pageMetadata } from "@/lib/seo";
import { PrivacyPage } from "@/components/content-pages";
export async function generateMetadata(){return pageMetadata("/privacy",false);}
export default function Page(){return <PrivacyPage/>;}
