import { publicSupabase } from "@/lib/server";
import { request } from "@/lib/requests";
export async function GET(_request:Request,{params}:{params:Promise<{userId:string}>}){
 const {userId}=await params;
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId))return new Response(null,{status:404});
 const db=publicSupabase();if(!db)return new Response(null,{status:503});
 try{
  const {data,error}=await request(signal=>db.from("staff_profiles").select("avatar_path").eq("user_id",userId).abortSignal(signal).maybeSingle());
  if(error||!data?.avatar_path)return new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});
  const {data:photo}=db.storage.from("staff-avatars").getPublicUrl(data.avatar_path);
  return new Response(null,{status:307,headers:{Location:photo.publicUrl,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
 }catch{return new Response(null,{status:503,headers:{"Cache-Control":"no-store"}});}
}
