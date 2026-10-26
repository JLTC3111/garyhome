import { VinhomesPage } from "@/components/vinhomes-collection";
import { pageMetadata } from "@/lib/seo";
export async function generateMetadata() { return pageMetadata("/vinhomes"); }
export default function Page() { return <VinhomesPage/>; }
