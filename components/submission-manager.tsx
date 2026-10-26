"use client";
import { useEffect, useState, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import { useSite } from "./site-context";
import { SelectField } from "./select-field";
import { canReorderProperties } from "@/lib/staff";
import { CHANNELS, SUBMISSION_STATUS, type AssistanceReport, type AssistanceReview, type FeedbackSubmission, type PublicFeedback } from "@/lib/submissions";
import { notifyPublicFeedbackChanged } from "@/lib/published-feedback";
import { listingCode } from "@/lib/rentals";

type StaffChoice={user_id:string;display_name:string;role:string};
export function SubmissionManager({kind}:{kind:"feedback"|"assistance"}){
 const {user,demo,staffRole,t}=useSite();
 if(demo)return <p className="form-info">{t("Customer feedback and help records are available in the connected Studio.","Phản hồi và thông tin hỗ trợ có trong Studio đã kết nối.")}</p>;
 if(!user||kind==="assistance"&&!canReorderProperties(staffRole))return null;
 return <Manager key={user.id+kind} kind={kind}/>;
}
function Manager({kind}:{kind:"feedback"|"assistance"}){
 const {t,editorTask,language,content}=useSite();
 const [feedback,setFeedback]=useState<FeedbackSubmission[]>([]),[reports,setReports]=useState<AssistanceReport[]>([]),[reviews,setReviews]=useState<AssistanceReview[]>([]),[published,setPublished]=useState<PublicFeedback[]>([]),[staff,setStaff]=useState<StaffChoice[]>([]);
 const [version,setVersion]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(false),[busy,setBusy]=useState(false),[selected,setSelected]=useState<string|null>(null),[status,setStatus]=useState("");
 useEffect(()=>{let current=true;
  void editorTask(async(db,signal)=>{
   if(kind==="feedback"){
    const [a,b]=await Promise.all([db.from("feedback_submissions").select("id,name,email,rating,message,property_id,publish_consent,status,created_at").order("created_at",{ascending:false}).limit(500).abortSignal(signal),db.from("feedback_public").select("id,name,rating,message,property_id,staff_reply,published_at").abortSignal(signal)]);
    if(a.error||b.error)throw new Error();return {feedback:a.data as FeedbackSubmission[],published:b.data as PublicFeedback[]};
   }
   const [a,b,c]=await Promise.all([db.from("property_assistance").select("id,property_id,property_code,property_address,name,email,phone,helper_name,channel,helped_where,helped_on,helped_time,notes,status,created_at").order("created_at",{ascending:false}).limit(500).abortSignal(signal),db.from("assistance_reviews").select("report_id,credited_staff_id,confirmed_helper,internal_notes,reviewed_by,reviewed_at").abortSignal(signal),db.rpc("list_attribution_staff").abortSignal(signal)]);
   if(a.error||b.error||c.error)throw new Error();return {reports:a.data as AssistanceReport[],reviews:b.data as AssistanceReview[],staff:c.data as StaffChoice[]};
  }).then(data=>{if(!current)return;if("feedback" in data){setFeedback(data.feedback!);setPublished(data.published!);}else{setReports(data.reports!);setReviews(data.reviews!);setStaff(data.staff!);}setError(false);}).catch(()=>{if(current)setError(true);}).finally(()=>{if(current)setLoading(false);});
  return()=>{current=false;};
 },[editorTask,kind,version]);
 const feedbackRow=feedback.find(r=>r.id===selected),report=reports.find(r=>r.id===selected),review=reviews.find(r=>r.report_id===selected);
 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy||!selected)return;const data=new FormData(event.currentTarget);setBusy(true);setError(false);
  try{
   const result=await editorTask((db,signal)=>kind==="feedback"?db.rpc("moderate_feedback",{submission_id:selected,decision:String(data.get("decision")),reply:String(data.get("reply")||"")}).abortSignal(signal):db.rpc("review_property_assistance",{report:selected,decision:String(data.get("decision")),credited_staff:String(data.get("credited_staff")||"")||null,helper:String(data.get("helper")||""),review_notes:String(data.get("review_notes")||"")}).abortSignal(signal));
   if(result.error)throw result.error;if(kind==="feedback")notifyPublicFeedbackChanged();setSelected(null);setLoading(true);setVersion(v=>v+1);
  }catch{setError(true);}finally{setBusy(false);}
 }
 const propertyCode=(id:string|null,snapshot="")=>{const p=content.properties.find(p=>p.id===id);return p?listingCode(p):snapshot||id||t("General experience","Trải nghiệm chung");};
 return <section className="admin-panel submission-manager"><div className="panel-heading"><div><h2>{kind==="feedback"?t("Customer feedback","Phản hồi khách hàng"):t("Assistance & commission attribution","Hỗ trợ & ghi nhận hoa hồng")}</h2><p>{kind==="feedback"?t("Publish only with the customer’s permission. Email addresses stay private.","Chỉ đăng khi khách hàng cho phép. Email được giữ riêng tư."):t("Verify the customer’s account of who helped, where and when before assigning credit. This records attribution; payouts are handled separately.","Xác minh người hỗ trợ, địa điểm và thời gian trước khi ghi nhận hoa hồng. Việc thanh toán được xử lý riêng.")}</p></div><button className="text-link" type="button" disabled={loading||busy} onClick={()=>{setLoading(true);setSelected(null);setVersion(v=>v+1);}}><RefreshCw size={16}/>{t("Refresh","Tải lại")}</button></div>
  {error&&<p className="form-error" role="alert">{t("Couldn’t confirm the latest data or save. Refresh before trying again.","Chưa thể xác nhận dữ liệu hoặc lưu. Tải lại trước khi thử lại.")}</p>}
  {loading?<p role="status">{t("Loading…","Đang tải…")}</p>:<>
   <label className="submission-status-filter">{t("Filter by status","Lọc theo trạng thái")}<SelectField value={status} onValueChange={setStatus}><option value="">{t("All statuses","Tất cả trạng thái")}</option>{(kind==="feedback"?["pending","approved","declined"]:["submitted","verified","needs_details","declined"]).map(s=><option key={s} value={s}>{t(...SUBMISSION_STATUS[s])}</option>)}</SelectField></label>
   <div className="submission-records">{(kind==="feedback"?feedback:reports).filter(r=>!status||r.status===status).map(row=><button className={`submission-record ${selected===row.id?"selected":""}`} type="button" disabled={busy} key={row.id} onClick={()=>setSelected(row.id)}><span><strong>{row.name}</strong><small>{propertyCode(row.property_id,"property_code" in row?String(row.property_code||""):"")} · {new Date(row.created_at).toLocaleDateString(language==="vi"?"vi-VN":"en-GB")}</small></span><span className="status-badge">{t(...SUBMISSION_STATUS[row.status])}</span></button>)}</div>
   {!(kind==="feedback"?feedback:reports).length&&!error&&<p className="admin-empty">{t("Customer submissions will appear here.","Thông tin khách hàng gửi sẽ xuất hiện tại đây.")}</p>}
  </>}
  {selected&&(feedbackRow||report)&&<form className="editor-form submission-review-editor" key={selected} onSubmit={save}>
   <div className="submission-review-heading"><h3>{(feedbackRow||report)!.name}</h3><p><a href={`mailto:${(feedbackRow||report)!.email}`}>{(feedbackRow||report)!.email}</a>{report?.phone&&<> · <a href={`tel:${report.phone.replace(/[^+\d]/g,"")}`}>{report.phone}</a></>}</p><strong>{propertyCode((feedbackRow||report)!.property_id,report?.property_code)}</strong></div>
   {feedbackRow?<><div className="submitted-copy"><strong>{feedbackRow.rating} / 5</strong><p>{feedbackRow.message}</p><small>{feedbackRow.publish_consent?t("Publication permission given","Đã cho phép đăng công khai"):t("Private feedback: publication permission not given","Phản hồi riêng tư: chưa cho phép đăng công khai")}</small></div><label>{t("Public Gary Home reply (optional)","Phản hồi công khai từ Gary Home (tùy chọn)")}<textarea name="reply" rows={3} maxLength={2000} defaultValue={published.find(r=>r.id===selected)?.staff_reply||""}/></label><label>{t("Decision","Quyết định")}<SelectField name="decision" defaultValue={feedbackRow.status==="approved"?"approved":"declined"}><option value="approved" disabled={!feedbackRow.publish_consent}>{t("Approve & publish","Duyệt & đăng")}</option><option value="declined">{t("Keep private / remove from public reviews","Giữ riêng tư / gỡ đánh giá công khai")}</option></SelectField></label></>:report&&<>
    <dl className="assistance-facts"><div><dt>{t("Who","Người hỗ trợ")}</dt><dd>{report.helper_name}</dd></div><div><dt>{t("Channel","Kênh hỗ trợ")}</dt><dd>{CHANNELS[report.channel]?t(...CHANNELS[report.channel]):report.channel}</dd></div><div><dt>{t("Where","Địa điểm")}</dt><dd>{report.helped_where}</dd></div><div><dt>{t("When (Hanoi)","Thời gian (Hà Nội)")}</dt><dd>{report.helped_on}{report.helped_time?` · ${report.helped_time.slice(0,5)}`:""}</dd></div></dl>{report.notes&&<p className="submitted-copy">{report.notes}</p>}
    <label>{t("Confirmed helper’s name","Tên người hỗ trợ đã xác minh")}<input name="helper" required minLength={2} maxLength={160} defaultValue={review?.confirmed_helper||report.helper_name}/></label>
    <label>{t("Credit staff account (optional)","Tài khoản nhân viên được ghi nhận (tùy chọn)")}<SelectField name="credited_staff" defaultValue={review?.credited_staff_id||""}><option value="">{t("External referrer / no staff account","Người giới thiệu bên ngoài / không có tài khoản")}</option>{review?.credited_staff_id&&!staff.some(person=>person.user_id===review.credited_staff_id)&&<option value={review.credited_staff_id}>{t("Current assignment (not in your directory)","Phân công hiện tại (ngoài danh bạ của bạn)")}</option>}{staff.map(s=><option key={s.user_id} value={s.user_id}>{s.display_name}</option>)}</SelectField></label>
    <label>{t("Internal verification notes","Ghi chú xác minh nội bộ")}<textarea name="review_notes" rows={4} maxLength={4000} defaultValue={review?.internal_notes||""}/></label>
    <label>{t("Decision","Quyết định")}<SelectField name="decision" defaultValue={report.status==="submitted"?"needs_details":report.status}><option value="verified">{t("Verified — confirm credit","Đã xác minh — ghi nhận hoa hồng")}</option><option value="needs_details">{t("More details needed","Cần thêm thông tin")}</option><option value="declined">{t("Not verified","Không được xác minh")}</option></SelectField></label>
    {review&&<p className="muted small">{t("Last reviewed","Xem xét gần nhất")}: {new Date(review.reviewed_at).toLocaleString(language==="vi"?"vi-VN":"en-GB",{timeZone:"Asia/Ho_Chi_Minh"})}</p>}
   </>}
   <div className="property-order-actions"><button className="button" type="submit" disabled={busy}>{busy?t("Saving…","Đang lưu…"):t("Save decision","Lưu quyết định")}</button><button className="button button-outline" type="button" disabled={busy} onClick={()=>setSelected(null)}>{t("Close","Đóng")}</button></div>
  </form>}
 </section>;
}
