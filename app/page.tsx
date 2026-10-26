import { HomePage } from "@/components/home-page";
import { loadPublicFeedback } from "@/lib/published-feedback-server";
export default async function Page(){const feedback=await loadPublicFeedback(6);return <HomePage reviews={feedback.reviews} feedbackUnavailable={feedback.unavailable}/>;}
