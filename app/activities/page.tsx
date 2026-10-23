import { pageMetadata } from "@/lib/seo";
import { Suspense } from "react";
import { ActivitiesPage } from "@/components/activities-page";
export async function generateMetadata(){return pageMetadata("/activities",false);}
export default function Page(){return <Suspense><ActivitiesPage/></Suspense>;}
