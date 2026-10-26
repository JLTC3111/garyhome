"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useSite } from "./site-context";
import { SUBMISSION_STATUS, type AssistanceReport, type FeedbackSubmission } from "@/lib/submissions";
import { notifyPublicFeedbackChanged } from "@/lib/published-feedback";
import { listingCode } from "@/lib/rentals";

export function SubmissionHistory(){const {user}=useSite();return user?<History key={user.id}/>:null;}
function History(){
 const {user,t,language,accountTask,content}=useSite();
 const [feedback,setFeedback]=useState<FeedbackSubmission[]>([]),[reports,setReports]=useState<AssistanceReport[]>([]),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false),[version,setVersion]=useState(0),[busy,setBusy]=useState<string|null>(null);
 useEffect(()=>{let current=true;
  void accountTask(async(db,signal,userId)=>{
   const [f,a]=await Promise.all([db.from("feedback_submissions").select("id,name,email,rating,message,property_id,publish_consent,status,created_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(100).abortSignal(signal),db.from("property_assistance").select("id,property_id,property_code,property_address,name,email,phone,helper_name,channel,helped_where,helped_on,helped_time,notes,status,created_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(100).abortSignal(signal)]);
   if(f.error||a.error)throw new Error();return {feedback:f.data as FeedbackSubmission[],reports:a.data as AssistanceReport[]};
  }).then(data=>{if(current){setFeedback(data.feedback);setReports(data.reports);setFailed(false);}}).catch(()=>{if(current)setFailed(true);}).finally(()=>{if(current)setLoading(false);});
  return()=>{current=false;};
 },[accountTask,user?.id,version]);
 async function withdraw(id:string){setBusy(id);try{const {error,data}=await accountTask((db,signal,userId)=>db.from("feedback_submissions").delete().eq("id",id).eq("user_id",userId).select("id").abortSignal(signal));if(error||!data?.length)throw new Error();setFeedback(rows=>rows.filter(row=>row.id!==id));notifyPublicFeedbackChanged();}catch{setFailed(true);}finally{setBusy(null);}}
 return <section className="submission-history"><div className="section-heading"><h2>{t("My feedback & help records","Phản hồi & thông tin hỗ trợ của tôi")}</h2><button type="button" className="text-link" disabled={loading||!!busy} onClick={()=>{setLoading(true);setVersion(v=>v+1);}}><RefreshCw size={16}/>{t("Refresh","Tải lại")}</button></div>
  {failed&&<p className="form-error" role="alert">{t("Couldn’t confirm the latest records. Refresh before trying again.","Chưa thể xác nhận dữ liệu mới nhất. Tải lại trước khi thử lại.")}</p>}
  {loading?<p role="status">{t("Loading your submissions…","Đang tải thông tin đã gửi…")}</p>:<>
   {!feedback.length&&!reports.length&&!failed&&<p className="muted">{t("Submissions sent while signed in will appear here.","Thông tin được gửi khi đăng nhập sẽ xuất hiện tại đây.")}</p>}
   {feedback.map(row=><article className="submission-history-row" key={row.id}><div><strong>{t("Feedback","Phản hồi")} · {row.rating}/5</strong><p>{row.message}</p><small>{new Date(row.created_at).toLocaleDateString(language==="vi"?"vi-VN":"en-GB")} · {t(...SUBMISSION_STATUS[row.status])}</small></div><button className="text-link" type="button" disabled={!!busy} onClick={()=>void withdraw(row.id)}>{busy===row.id?t("Removing…","Đang xóa…"):t("Withdraw & remove","Rút lại & xóa")}</button></article>)}
   {reports.map(row=><article className="submission-history-row" key={row.id}><div><strong>{t("Help record","Thông tin hỗ trợ")} · {listingCode(content.properties.find(p=>p.id===row.property_id)||{id:row.property_code||row.property_id||row.id})}</strong><p>{row.helper_name} · {row.helped_where} · {new Date(row.helped_on+"T00:00:00+07:00").toLocaleDateString(language==="vi"?"vi-VN":"en-GB",{timeZone:"Asia/Ho_Chi_Minh"})}{row.helped_time?` · ${row.helped_time.slice(0,5)}`:""}</p><small>{t(...SUBMISSION_STATUS[row.status])}</small></div></article>)}
  </>}
 </section>;
}
