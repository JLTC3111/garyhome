import { TipsPage } from "@/components/about-sections";
import { pageMetadata } from "@/lib/seo";
export async function generateMetadata(){return pageMetadata("/tips-and-news");}
export default function Page(){return <TipsPage/>;}
