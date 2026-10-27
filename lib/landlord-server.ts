import { readJsonBody, BodyReadError } from "./request-body";
import { z } from "zod";
import { backendConfig,publicSupabase,staffAdminClient } from "./server";
import { runtimeEnv } from "./runtime-env";
import { LANDLORD_BUCKET,LANDLORD_MAX_FILE,landlordPrepare,landlordFinalise,safeLandlordFilename,landlordMimeExtensions,type UploadPermit } from "./landlords";
const encoder=new TextEncoder();
function signingSecret(){return runtimeEnv.SUPABASE_SECRET_KEY||process.env.SUPABASE_SECRET_KEY||runtimeEnv.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||"";}
const base64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
function unbase64(value:string){return Uint8Array.from(atob(value.replaceAll("-","+").replaceAll("_","/")),c=>c.charCodeAt(0));}
async function hmacKey(){const secret=signingSecret();if(!secret)throw new Error("unavailable");return crypto.subtle.importKey("raw",encoder.encode("GaryHome/landlord-upload/v1/"+secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);}
export async function signUploadPermit(payload:UploadPermit){const body=base64(encoder.encode(JSON.stringify(payload)));return body+"."+base64(new Uint8Array(await crypto.subtle.sign("HMAC",await hmacKey(),encoder.encode(body))));}
const permitSchema=z.object({v:z.literal(1),id:z.string().uuid(),expires:z.number().int(),userId:z.string().uuid().nullable(),files:z.array(z.object({id:z.string().uuid(),path:z.string(),name:z.string(),type:z.string(),size:z.number().int()})).max(6)});
export async function readUploadPermit(token:string):Promise<UploadPermit>{
 try{const parts=token.split(".");if(parts.length!==2||!await crypto.subtle.verify("HMAC",await hmacKey(),unbase64(parts[1]),encoder.encode(parts[0])))throw new Error();
 const data=permitSchema.parse(JSON.parse(new TextDecoder().decode(unbase64(parts[0]))));if(data.expires<=Date.now())throw new Error("expired");return data;
 }catch(error){if(error instanceof Error&&error.message==="expired")throw error;throw new Error("invalid");}
}
export async function cleanUnusedLandlordUploads(db:NonNullable<ReturnType<typeof staffAdminClient>>){
 const {data,error}=await db.rpc("unused_landlord_uploads");if(error)throw new Error("unavailable");
 const paths=(data as {storage_path:string}[]||[]).map(row=>row.storage_path);if(paths.length){const result=await db.storage.from(LANDLORD_BUCKET).remove(paths);if(result.error)throw new Error("connection");}return paths.length;
}
export async function landlordRequest(request:Request){
 const fail=(code:string,status=400)=>Response.json({error:code},{status,headers:{"Cache-Control":"no-store"}});
 if(request.headers.get("origin")&&request.headers.get("origin")!==new URL(request.url).origin)return fail("origin",403);
 if(!request.headers.get("content-type")?.startsWith("application/json"))return fail("invalid",415);
 if(Number(request.headers.get("content-length")||0)>32000)return fail("invalid",413);
 const db=staffAdminClient();if(!db)return fail("unavailable",503);
 try{
  const auth=request.headers.get("authorization"),token=auth?.match(/^Bearer (\S+)$/i)?.[1];if(auth&&!token)return fail("session",401);
  let userId:string|null=null;
  if(token){const result=await publicSupabase(token)?.auth.getUser(token);if(!result||result.error||!result.data.user)return fail("session",401);userId=result.data.user.id;}
  let body:unknown;try{body=await readJsonBody(request,32000);}catch(error){return fail(error instanceof BodyReadError?"invalid":"connection",error instanceof BodyReadError?error.status:503);}
  const preparation=landlordPrepare.safeParse(body);
  if(preparation.success){
   const files=preparation.data.files;
   const ip=(process.env.VERCEL==="1"?request.headers.get("x-forwarded-for")?.split(",")[0]?.trim():request.headers.get("cf-connecting-ip"))||"local";
   const signature=new Uint8Array(await crypto.subtle.sign("HMAC",await hmacKey(),encoder.encode("quota/"+ip)));
   const quota=await db.rpc("reserve_landlord_upload",{client_key:Array.from(signature,b=>b.toString(16).padStart(2,"0")).join(""),upload_bytes:files.length*LANDLORD_MAX_FILE});
   if(quota.error)return fail("unavailable",503);if(!quota.data)return fail("rate",429);
   const id=crypto.randomUUID(),expires=Date.now()+2*60*60*1000;
   const prepared=[];
   for(const file of files){const fileId=crypto.randomUUID(),path=id+"/"+fileId+"."+landlordMimeExtensions[file.type];
    const {data,error}=await db.storage.from(LANDLORD_BUCKET).createSignedUploadUrl(path,{upsert:false});if(error||!data)return fail("unavailable",503);
    prepared.push({id:fileId,path,name:safeLandlordFilename(file.name),type:file.type,size:file.size,token:data.token});
   }
   const payload:UploadPermit={v:1,id,expires,userId,files:prepared.map(file=>({id:file.id,path:file.path,name:file.name,type:file.type,size:file.size}))};
   const {url,key}=backendConfig();return Response.json({permit:await signUploadPermit(payload),expires,url,key,files:prepared},{headers:{"Cache-Control":"no-store"}});
  }
  const finalisation=landlordFinalise.safeParse(body);if(!finalisation.success)return fail("invalid");
  let permit:UploadPermit;try{permit=await readUploadPermit(finalisation.data.permit);}catch(error){return fail(error instanceof Error?error.message:"invalid");}
  if(userId!==permit.userId)return fail("session",401);
  for(const file of permit.files){
   const {data,error}=await db.storage.from(LANDLORD_BUCKET).info(file.path);
   if(error||!data||Number(data.size??data.metadata?.size)!==file.size||data.contentType!==file.type)return fail("files",409);
  }
  const details=Object.fromEntries(Object.entries(finalisation.data.details).filter(([key])=>key!=="consent"&&key!=="website"));
  const result=await db.rpc("finalize_landlord_submission",{submission_id:permit.id,verified_user:userId,details,files:permit.files});
  if(result.error)return ["23503","23514","22P02"].includes(result.error.code)?fail("invalid",400):fail("unavailable",503);
  // Cleanup is bounded and best effort; failed cleanup must never turn a saved
  // introduction into an apparent failure. Admins also have an explicit action.
  try{await cleanUnusedLandlordUploads(db);}catch{/* a later submission/admin cleanup can retry */}
  return Response.json({ok:true,id:permit.id},{status:201,headers:{"Cache-Control":"no-store"}});
 }catch{return fail("connection",503);}
}
