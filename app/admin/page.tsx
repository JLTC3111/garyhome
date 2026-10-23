import { pageMetadata } from "@/lib/seo";
import { AdminPage } from "@/components/admin-page";
export async function generateMetadata(){return pageMetadata("/admin",true);}
export default function Page(){return <AdminPage/>;}
