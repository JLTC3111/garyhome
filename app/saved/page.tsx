import { pageMetadata } from "@/lib/seo";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { HomesPage } from "@/components/homes-page";
export async function generateMetadata(){return pageMetadata("/saved",true);}
export default function Page() { return <Suspense fallback={<PageLoading/>}><HomesPage savedOnly/></Suspense>; }
