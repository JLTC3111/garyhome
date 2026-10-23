import { pageMetadata } from "@/lib/seo";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { ContactPage } from "@/components/content-pages";
export async function generateMetadata(){return pageMetadata("/contact",false);}
export default function Page(){return <Suspense fallback={<PageLoading/>}><ContactPage/></Suspense>;}
