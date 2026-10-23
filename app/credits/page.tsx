import { pageMetadata } from "@/lib/seo";
import { CreditsPage } from "@/components/credits-page";
export async function generateMetadata(){return pageMetadata("/credits",false);}
export default function Page(){return <CreditsPage/>;}
