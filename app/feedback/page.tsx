import { pageMetadata } from "@/lib/seo";
import { Activities } from "@/components/activities";
export async function generateMetadata(){return pageMetadata("/feedback",false);}
export default function Page(){return <Activities full initialCategory="feedback"/>;}
