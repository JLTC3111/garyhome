import { pageMetadata } from "@/lib/seo";
import { FeedbackPage } from "@/components/feedback-page";
import { loadPublicFeedback } from "@/lib/published-feedback-server";
export async function generateMetadata(){return pageMetadata("/feedback",false);}
export default async function Page(){const data=await loadPublicFeedback();return <FeedbackPage reviews={data.reviews} unavailable={data.unavailable}/>;}
