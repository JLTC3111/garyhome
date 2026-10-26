import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicFeedback } from "./submissions";
export const PUBLIC_FEEDBACK_FIELDS="id,name,rating,message,property_id,staff_reply,published_at";
export const PUBLIC_FEEDBACK_EVENT="gary-public-feedback-changed";
export const PUBLIC_FEEDBACK_STORAGE="gary-public-feedback-version";
export async function readPublicFeedback(db:SupabaseClient,limit=50,signal?:AbortSignal):Promise<PublicFeedback[]>{
 const query=db.from("feedback_public").select(PUBLIC_FEEDBACK_FIELDS).order("published_at",{ascending:false}).order("id",{ascending:false}).limit(Math.max(1,Math.min(limit,50)));
 const {data,error}=await (signal?query.abortSignal(signal):query);if(error)throw error;return data||[];
}
export function notifyPublicFeedbackChanged(){if(typeof window==="undefined")return;window.dispatchEvent(new Event(PUBLIC_FEEDBACK_EVENT));try{localStorage.setItem(PUBLIC_FEEDBACK_STORAGE,String(Date.now()));}catch{/* Optional cross-tab notification. */}}
