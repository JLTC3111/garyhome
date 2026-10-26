import { TipsPage } from "@/components/about-sections";
import { pageMetadata, loadPageContent } from "@/lib/seo";
export async function generateMetadata(){return pageMetadata("/tips-and-news");}
export default async function Page(){const {content}=await loadPageContent();return <TipsPage articles={content.editorial}/>;}
