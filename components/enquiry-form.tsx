"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Mail, Phone } from "lucide-react";
import { useSite } from "./site-context";
import { fetchWithDeadline } from "@/lib/requests";
import { studioText } from "@/lib/studio-i18n";
import type { Enquiry, Property } from "@/lib/types";

export function EnquiryForm({ property, kind="general" }: { property?: Property; kind?: Enquiry["kind"] }) {
  const { t, configured, content, enquiries, setEnquiries, language }=useSite();
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [success,setSuccess]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setError("");setBusy(true);
    const form=new FormData(event.currentTarget);
    const input={name:String(form.get("name")||"").trim(),email:String(form.get("email")||"").trim(),phone:String(form.get("phone")||"").trim(),message:String(form.get("message")||"").trim(),preferred_date:String(form.get("preferred_date")||"")||null,kind:property?"viewing":kind,property_id:property?.id||null,consent:form.get("consent")==="on",website:String(form.get("website")||"")};
    try {
      if (input.name.length<2 || input.message.length<10 || !input.consent) throw new Error(t("Please enter your name, a message of at least 10 characters, and consent.","Vui lòng nhập tên, lời nhắn ít nhất 10 ký tự và đồng ý chính sách."));
      if(input.website)throw new Error("Couldn’t process this request.");
      if(configured) {
        const response=await fetchWithDeadline("/api/enquiries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});
        const data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error||t("Please try again.","Vui lòng thử lại."));
      } else {
        const {website:_website,...data}=input;
        setEnquiries([{...data,id:crypto.randomUUID(),kind:data.kind as Enquiry["kind"],status:"new",notes:"",created_at:new Date().toISOString()},...enquiries]);
      }
      setSuccess(true);
    } catch(e) { setError(e instanceof Error?e.message:t("Couldn’t send your request.","Không thể gửi yêu cầu.")); } finally { setBusy(false); }
  }
  if(success)return <div className="form-success" role="status"><span><Check size={29}/></span><h3>{configured?t("A good beginning.","Khởi đầu tốt đẹp."):t("Your preview request is saved.","Yêu cầu xem trước đã được lưu.")}</h3><p>{configured?t("Your request is in our inbox. The team will contact you to confirm the details. Your viewing is confirmed only after we get in touch.","Đội ngũ đã nhận yêu cầu và sẽ liên hệ xác nhận chi tiết. Lịch xem nhà được xác nhận sau khi trao đổi."):t("This request is saved on this device only and has not been sent. For a real viewing, contact Gary Home directly.","Yêu cầu chỉ lưu trên thiết bị này và chưa được gửi. Để xem nhà thực tế, vui lòng liên hệ Gary Home.")}</p><a className="button button-outline" href={`tel:${content.settings.contact_phone.replace(/\s/g,"")}`}><Phone size={16}/>{t("Call the team","Gọi đội ngũ")}</a><button className="text-link" onClick={()=>setSuccess(false)}>{t("Send another request","Gửi yêu cầu khác")}</button></div>;
  return <form className="enquiry-form" onSubmit={submit}>{!configured && <div className="form-info">{t("Preview mode: requests stay on this device. Call or email us to arrange a real viewing.","Chế độ xem trước: yêu cầu chỉ lưu trên thiết bị này. Gọi hoặc gửi email để đặt lịch thực tế.")}</div>}<div className="form-row"><label>{t("Your name","Họ và tên")}<input name="name" required minLength={2} maxLength={120} autoComplete="name" placeholder={t("What should we call you?","Tên của bạn")}/></label><label>{t("Email address","Địa chỉ email")}<input type="email" name="email" required maxLength={254} autoComplete="email" placeholder="you@example.com"/></label></div><div className="form-row"><label>{t("Phone number","Số điện thoại")}<span className="field-optional">{t("optional","không bắt buộc")}</span><input name="phone" type="tel" maxLength={40} autoComplete="tel" placeholder="+84…"/></label><label>{t("Preferred viewing date","Ngày muốn xem nhà")}<span className="field-optional">{t("optional","không bắt buộc")}</span><input name="preferred_date" type="date" min={new Date().toISOString().slice(0,10)}/></label></div><label>{t("A little about your plans","Chia sẻ về nhu cầu của bạn")}<textarea name="message" required minLength={10} maxLength={4000} rows={4} placeholder={t("Your move-in date, your budget, your must-haves…","Ngày chuyển vào, ngân sách, tiện nghi bạn cần…")}/></label><label className="honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off"/></label><label className="consent-label"><input type="checkbox" name="consent" required/><span>{t("I agree to Gary Home using my details to respond to this request. See our","Tôi đồng ý để Gary Home sử dụng thông tin để phản hồi yêu cầu. Xem")} <Link href="/privacy" target="_blank">{t("privacy policy","chính sách bảo mật")}</Link>.</span></label>{error && <div className="form-error" role="alert">{studioText(error,language)}</div>}<button className="button" disabled={busy} type="submit">{busy?t("Sending…","Đang gửi…"):configured?t(property?"Request a viewing":"Say hello",property?"Đặt lịch xem nhà":"Gửi lời chào"):t("Save preview request","Lưu yêu cầu xem trước")}<ArrowUpRight size={17}/></button><p className="form-fineprint">{t("No commitment. Just a conversation about your next home.","Không ràng buộc. Chỉ là cuộc trò chuyện về ngôi nhà tiếp theo.")}</p></form>;
}
