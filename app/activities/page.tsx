import { pageMetadata } from "@/lib/seo";
import { Suspense } from "react";
import { loadPublicFeedback } from "@/lib/published-feedback-server";
import { ActivitiesPage } from "@/components/activities-page";
export async function generateMetadata(){return pageMetadata("/activities",false);}
export default async function Page(){const feedback=await loadPublicFeedback();return <Suspense><ActivitiesPage reviews={feedback.reviews} unavailable={feedback.unavailable}/></Suspense>;}
