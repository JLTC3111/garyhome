import { pageMetadata } from "@/lib/seo";
import { AboutPage } from "@/components/content-pages";
export async function generateMetadata(){return pageMetadata("/about",false);}
export default function Page(){return <AboutPage/>;}
