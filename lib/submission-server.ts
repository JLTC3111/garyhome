import { readJsonBody, BodyReadError } from "./request-body";
import { publicSupabase } from "./server";
import { assistanceInput, feedbackInput, validHelpDate } from "./submissions";

// Best-effort instance limits supplement Postgres constraints and RLS.
const requests=new Map<string,number[]>();
export async function submitCustomerInput(request:Request,kind:"feedback"|"assistance"){
 const fail=(code:string,status:number)=>Response.json({error:code},{status});
 const origin=request.headers.get("origin");
 if(origin&&origin!==new URL(request.url).origin)return fail("origin",403);
 if(Number(request.headers.get("content-length")||0)>16000)return fail("invalid",413);
 const authorization=request.headers.get("authorization"),token=authorization?.match(/^Bearer (\S+)$/i)?.[1];
 if(authorization&&!token)return fail("session",401);
 const db=publicSupabase(token);if(!db)return fail("unavailable",503);
 let input:unknown;
 try{input=await readJsonBody(request,16000);}catch(error){return fail(error instanceof BodyReadError?"invalid":"connection",error instanceof BodyReadError?error.status:503);}
 const parsed=(kind==="feedback"?feedbackInput:assistanceInput).safeParse(input);
 if(!parsed.success)return fail("invalid",400);
 if("helped_on" in parsed.data&&!validHelpDate(parsed.data.helped_on))return fail("date",400);
 try{
  if(token){const {data,error}=await db.auth.getUser(token);if(error||!data.user)return fail("session",401);}
  const ip=(process.env.VERCEL==="1"?request.headers.get("x-forwarded-for")?.split(",")[0]?.trim():request.headers.get("cf-connecting-ip"))||"local";
  const key=kind+":"+ip,now=Date.now();
  for(const [bucket,times] of requests)if(times.every(t=>now-t>600000))requests.delete(bucket);
  const recent=(requests.get(key)||[]).filter(t=>now-t<600000);if(recent.length>=5)return fail("rate",429);
  requests.set(key,[...recent,now]);
  // Zod strips caller-supplied user IDs, moderation status and attribution fields.
  const record:Record<string,unknown>={...parsed.data};delete record.website;
  const {error}=await db.from(kind==="feedback"?"feedback_submissions":"property_assistance").insert(record);
  if(error)return fail(["42P01","PGRST204"].includes(error.code||"")?"unavailable":"save",503);
  return Response.json({ok:true},{status:201});
 }catch{return fail("connection",503);}
}
