import { ServicesPage } from "@/components/about-sections";
import { pageMetadata } from "@/lib/seo";
export async function generateMetadata(){return pageMetadata("/services");}
export default function Page(){return <ServicesPage/>;}
