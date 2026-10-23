import { pageMetadata } from "@/lib/seo";
import { FeedbackPage } from "@/components/feedback-page";
import { publicSupabase } from "@/lib/server";
import type { PublicFeedback } from "@/lib/submissions";
export async function generateMetadata(){return pageMetadata("/feedback",false);}
export default async function Page(){
 const db=publicSupabase();let reviews:PublicFeedback[]=[],unavailable=false;
 if(db)try{const {data,error}=await db.from("feedback_public").select("id,name,rating,message,property_id,staff_reply,published_at").order("published_at",{ascending:false}).limit(50);if(error)unavailable=true;else reviews=data||[];}catch{unavailable=true;}
 return <FeedbackPage reviews={reviews} unavailable={unavailable}/>;
}
