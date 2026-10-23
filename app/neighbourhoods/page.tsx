import { pageMetadata } from "@/lib/seo";
import { NeighbourhoodsPage } from "@/components/content-pages";
export async function generateMetadata(){return pageMetadata("/neighbourhoods",false);}
export default function Page(){return <NeighbourhoodsPage/>;}
