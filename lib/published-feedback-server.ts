import { publicSupabase } from "./server";
import { readPublicFeedback } from "./published-feedback";
import type { PublicFeedback } from "./submissions";
export async function loadPublicFeedback(limit=50):Promise<{reviews:PublicFeedback[];unavailable:boolean}>{
 const db=publicSupabase();if(!db)return {reviews:[],unavailable:false};
 try{return {reviews:await readPublicFeedback(db,limit),unavailable:false};}catch{return {reviews:[],unavailable:true};}
}
