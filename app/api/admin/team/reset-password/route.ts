import { z } from "zod";
import { readJsonBody, BodyReadError } from "@/lib/request-body";
import { request as boundedRequest } from "@/lib/requests";
import { StaffRequestError,staffRequest } from "@/lib/staff-server";
import { requestStaffPasswordEmail } from "@/lib/staff-email";

const input=z.object({user_id:z.string().uuid()});
const headers={"Cache-Control":"private, no-store"};
export async function POST(request:Request){
 try{
  await boundedRequest(async signal=>{
   const {db}=await staffRequest(request,signal);
   let body:unknown;try{body=await readJsonBody(request,2048);}catch(error){throw new StaffRequestError("Check the staff account.",error instanceof BodyReadError?error.status:503);}
   const parsed=input.safeParse(body);if(!parsed.success)throw new StaffRequestError("Check the staff account.");
   await requestStaffPasswordEmail(db,parsed.data.user_id,request.url,signal);
  });
  return Response.json({ok:true},{headers});
 }catch(error){return Response.json({error:error instanceof StaffRequestError?error.message:"Couldn’t confirm the reset request. Refresh before trying again."},{status:error instanceof StaffRequestError?error.status:503,headers});}
}
