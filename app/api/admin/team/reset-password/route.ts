import { z } from "zod";
import { request as boundedRequest } from "@/lib/requests";
import { StaffRequestError,staffRequest } from "@/lib/staff-server";
import { requestStaffPasswordEmail } from "@/lib/staff-email";

const input=z.object({user_id:z.string().uuid()});
const headers={"Cache-Control":"private, no-store"};
export async function POST(request:Request){
 try{
  await boundedRequest(async signal=>{
   const {db}=await staffRequest(request,signal);
   if(Number(request.headers.get("content-length")||0)>2048)throw new StaffRequestError("Request too large.",413);
   let body:unknown;try{const text=await request.text();if(text.length>2048)throw new Error();body=JSON.parse(text);}catch{throw new StaffRequestError("Check the staff account.");}
   const parsed=input.safeParse(body);if(!parsed.success)throw new StaffRequestError("Check the staff account.");
   await requestStaffPasswordEmail(db,parsed.data.user_id,request.url,signal);
  });
  return Response.json({ok:true},{headers});
 }catch(error){return Response.json({error:error instanceof StaffRequestError?error.message:"Couldn’t confirm the reset request. Refresh before trying again."},{status:error instanceof StaffRequestError?error.status:503,headers});}
}
