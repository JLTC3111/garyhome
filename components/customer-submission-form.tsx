"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Phone, Star } from "lucide-react";
import { useSite } from "./site-context";
import { SelectField } from "./select-field";
import { fetchWithDeadline } from "@/lib/requests";
import { CHANNELS, hanoiToday } from "@/lib/submissions";
import { isPublicRental, listingCode } from "@/lib/rentals";
import type { Property } from "@/lib/types";

const errors:Record<string,readonly[string,string]>={
 invalid:["Check all required fields and your privacy consent.","Kiểm tra các mục bắt buộc và đồng ý chính sách bảo mật."],
 date:["Choose a valid date on or before today (Hanoi time).","Chọn ngày hợp lệ, không sau hôm nay (giờ Hà Nội)."],
 session:["Please sign in again before sending.","Vui lòng đăng nhập lại trước khi gửi."],
 rate:["Please wait a few minutes before sending another submission.","Vui lòng đợi vài phút trước khi gửi tiếp."],
 unavailable:["This form is temporarily unavailable. Please call the hotline.","Biểu mẫu tạm thời chưa khả dụng. Vui lòng gọi hotline."],
 connection:["The send could not be confirmed. Check your submissions or contact the team before trying again.","Chưa thể xác nhận đã gửi. Kiểm tra bài gửi hoặc liên hệ đội ngũ trước khi thử lại."],
 save:["Couldn’t save this submission. Check the details or contact the team.","Không thể lưu thông tin. Kiểm tra chi tiết hoặc liên hệ đội ngũ."],
 origin:["Reload this page before sending.","Tải lại trang trước khi gửi."],
};
export function CustomerSubmissionForm(props:{kind:"feedback"|"assistance";property?:Property;onSent?:()=>void}){
 const {user}=useSite();
 return <SubmissionBody key={(user?.id||"guest")+(props.property?.id||"")+props.kind} {...props}/>;
}
function SubmissionBody({kind,property,onSent}:{kind:"feedback"|"assistance";property?:Property;onSent?:()=>void}){
 const {t,configured,user,accountTask,content}=useSite();
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[sent,setSent]=useState(false),[rating,setRating]=useState(0);
 const feedback=kind==="feedback",phone=content.settings.contact_phone;
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;setBusy(true);setError("");
  const data=new FormData(event.currentTarget);
  const common={name:String(data.get("name")||""),email:String(data.get("email")||""),consent:data.get("consent")==="on",website:String(data.get("website")||"")};
  const input=feedback?{...common,rating,message:String(data.get("message")||""),property_id:String(data.get("property_id")||"")||null,publish_consent:data.get("publish_consent")==="on"}:{...common,property_id:property?.id,phone:String(data.get("phone")||""),helper_name:String(data.get("helper_name")||""),channel:String(data.get("channel")||""),helped_where:String(data.get("helped_where")||""),helped_on:String(data.get("helped_on")||""),helped_time:String(data.get("helped_time")||"")||null,notes:String(data.get("notes")||"")};
  try{
   if(!configured)throw new Error("unavailable");
   const send=async(token?:string,signal?:AbortSignal)=>{
    const response=await fetchWithDeadline(`/api/${kind}`,{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(input),signal});
    const result=await response.json() as {error?:string};if(!response.ok)throw new Error(result.error||"save");
   };
   if(user)await accountTask(async(db,signal)=>{const {data,error}=await db.auth.getSession();if(error||!data.session)throw new Error("session");await send(data.session.access_token,signal);});else await send();
   setSent(true);onSent?.();
  }catch(error){setError(error instanceof Error&&errors[error.message]?error.message:"connection");}finally{setBusy(false);}
 }
 if(sent)return <div className="submission-success" role="status"><Check size={30}/><h3>{feedback?t("Thank you for sharing.","Cảm ơn bạn đã chia sẻ."):t("Your help record is received.","Đã nhận thông tin hỗ trợ.")}</h3><p>{feedback?t("The team will review your feedback. It will only be published if you gave permission and it is approved.","Đội ngũ sẽ xem xét phản hồi. Nội dung chỉ được đăng khi bạn cho phép và đã được duyệt."):t("An owner, admin or manager will verify the details before confirming whom to credit.","Chủ sở hữu, quản trị viên hoặc quản lý sẽ xác minh trước khi ghi nhận người được hưởng hoa hồng.")}</p>{!user&&<p>{t("Guest submissions are not linked to a future account. Contact the team if you need to correct your details.","Thông tin gửi khi chưa đăng nhập không tự liên kết với tài khoản sau này. Liên hệ đội ngũ nếu cần chỉnh sửa.")}</p>}<button type="button" className="text-link" onClick={()=>{setSent(false);setRating(0);}}>{t("Send another","Gửi thêm")}</button></div>;
 return <form className="enquiry-form customer-submission-form" onSubmit={submit}>
  {!configured&&<p className="form-info">{t(...errors.unavailable)}</p>}
  <div className="form-row"><label>{t("Your name","Họ và tên")}<input name="name" autoComplete="name" required minLength={2} maxLength={120} defaultValue={typeof user?.user_metadata?.full_name==="string"?user.user_metadata.full_name:""}/></label><label>{t("Email address","Địa chỉ email")}<input type="email" name="email" autoComplete="email" required maxLength={254} defaultValue={user?.email||""}/></label></div>
  {feedback?<>
   <fieldset className="feedback-rating"><legend>{t("Your experience","Trải nghiệm của bạn")}</legend><div>{[1,2,3,4,5].map(n=><label key={n} className={rating>=n?"rated":""}><input type="radio" name="rating" value={n} checked={rating===n} onChange={()=>setRating(n)} required/><Star size={25} fill={rating>=n?"currentColor":"none"} aria-hidden="true"/><span className="sr-only">{t(`${n} out of 5 stars`,`${n} trên 5 sao`)}</span></label>)}</div><span aria-live="polite">{rating?`${rating} / 5`:t("Choose a rating","Chọn mức đánh giá")}</span></fieldset>
   <label>{t("Property (optional)","Bất động sản (tùy chọn)")}<SelectField name="property_id" defaultValue=""><option value="">{t("My experience with Gary Home","Trải nghiệm với Gary Home")}</option>{content.properties.filter(isPublicRental).map(p=><option key={p.id} value={p.id}>{listingCode(p)} · {p.address}</option>)}</SelectField></label>
   <label>{t("Your feedback","Phản hồi của bạn")}<textarea name="message" rows={5} required minLength={10} maxLength={4000} placeholder={t("What went well? What could we do better? Please leave out private contact or financial details.","Điều gì làm bạn hài lòng? Chúng tôi có thể cải thiện gì? Không ghi thông tin liên hệ riêng hoặc tài chính.")}/></label>
  </>:<>
   <label>{t("Phone (optional)","Số điện thoại (tùy chọn)")}<input type="tel" name="phone" autoComplete="tel" maxLength={40}/></label>
   <label>{t("Who helped you find this property?","Ai đã hỗ trợ bạn tìm căn nhà này?")}<input name="helper_name" required minLength={2} maxLength={160} placeholder={t("Agent, staff member or referrer’s name","Tên nhân viên, môi giới hoặc người giới thiệu")}/></label>
   <label>{t("How did they help you?","Bạn được hỗ trợ qua đâu?")}<SelectField name="channel" defaultValue="" required><option value="">{t("Choose a channel","Chọn kênh hỗ trợ")}</option>{Object.entries(CHANNELS).map(([key,labels])=><option key={key} value={key}>{t(...labels)}</option>)}</SelectField></label>
   <label>{t("Where did you receive help?","Bạn nhận hỗ trợ ở đâu?")}<input name="helped_where" required minLength={2} maxLength={300} placeholder={t("Office, viewing address, website or conversation","Văn phòng, địa chỉ xem nhà, website hoặc cuộc trao đổi")}/></label>
   <div className="form-row"><label>{t("When did they help?","Bạn được hỗ trợ ngày nào?")}<input name="helped_on" type="date" required min="2000-01-01" max={hanoiToday()}/></label><label>{t("Time (optional · Hanoi)","Giờ (tùy chọn · Hà Nội)")}<input name="helped_time" type="time"/></label></div>
   <label>{t("Anything else? (optional)","Thông tin thêm (tùy chọn)")}<textarea name="notes" rows={3} maxLength={2000} placeholder={t("Details that help us verify the introduction or viewing.","Chi tiết giúp xác minh việc giới thiệu hoặc xem nhà.")}/></label>
  </>}
  <label className="honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off"/></label>
  <label className="consent-label"><input name="consent" type="checkbox" required/><span>{feedback?t("I agree to Gary Home reviewing and responding to my feedback.","Tôi đồng ý để Gary Home xem xét và phản hồi ý kiến."):t("I agree to Gary Home using these details to verify the assistance and commission attribution.","Tôi đồng ý để Gary Home sử dụng thông tin để xác minh việc hỗ trợ và ghi nhận hoa hồng.")} <Link href="/privacy" target="_blank">{t("Privacy policy","Chính sách bảo mật")}</Link>.</span></label>
  {feedback&&<label className="consent-label"><input name="publish_consent" type="checkbox"/><span>{t("Optional: Gary Home may publish my name, rating and feedback after moderation. My email stays private.","Tùy chọn: Gary Home có thể đăng tên, đánh giá và phản hồi sau khi duyệt. Email được giữ riêng tư.")}</span></label>}
  {error&&<p className="form-error" role="alert">{t(...errors[error])}</p>}
  <button type="submit" className="button" disabled={busy||!configured}>{busy?t("Sending…","Đang gửi…"):feedback?t("Send feedback","Gửi phản hồi"):t("Submit help record","Gửi thông tin hỗ trợ")}<ArrowUpRight size={17}/></button>
  {!feedback&&<p className="form-fineprint">{t("Details are private. Credit is confirmed after staff verification.","Thông tin được giữ riêng tư. Hoa hồng được ghi nhận sau khi xác minh.")}</p>}
  {!configured&&<a href={`tel:${phone.replace(/[^+\d]/g,"")}`} className="text-link"><Phone size={17}/>{phone}</a>}
 </form>;
}
