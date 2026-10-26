"use client";
import { useEffect,useRef,useState,type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { ArrowUpRight,Check,FileText,Upload,X } from "lucide-react";
import { useSite } from "./site-context";
import { SelectField } from "./select-field";
import { RENTAL_TYPES,typeLabel } from "@/lib/rentals";
import { fetchWithDeadline } from "@/lib/requests";
import { LANDLORD_BUCKET,landlordDetails,landlordManifest,landlordErrors,safeLandlordFilename,type PreparedUpload } from "@/lib/landlords";

function FilePreview({file}:{file:File}){
 const [src,setSrc]=useState("");useEffect(()=>{if(!file.type.startsWith("image/"))return;const url=URL.createObjectURL(file);let current=true;queueMicrotask(()=>{if(current)setSrc(url);});return()=>{current=false;URL.revokeObjectURL(url);};},[file]);
 return src?<img src={src} alt=""/>:<FileText size={26} aria-hidden="true"/>;
}
export function LandlordForm(){const {user}=useSite();return <LandlordFormBody key={user?.id||"guest"}/>;}
function LandlordFormBody(){
 const {t,language,content,configured,user,accountTask}=useSite();
 const [files,setFiles]=useState<File[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[progress,setProgress]=useState(0),[receipt,setReceipt]=useState("");
 const prepared=useRef<PreparedUpload|null>(null),uploaded=useRef(new Set<string>()),controller=useRef<AbortController|null>(null),mounted=useRef(true),lock=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
 function clearAttempt(){prepared.current=null;uploaded.current.clear();}
 function chooseFiles(selected:File[]){
  const next=[...files,...selected];const manifest=next.map(file=>({name:safeLandlordFilename(file.name),type:file.type,size:file.size}));
  if(!landlordManifest.safeParse(manifest).success){setError("invalid");return;}
  clearAttempt();setFiles(next);setError("");
 }
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(lock.current)return;setError("");const form=new FormData(event.currentTarget);
  const optionalNumber=(key:string)=>String(form.get(key)||"").trim()===""?null:Number(form.get(key));
  const details=landlordDetails.safeParse({owner_name:form.get("owner_name"),email:form.get("email"),phone:form.get("phone"),address:form.get("address"),district_slug:form.get("district_slug")||null,property_type:form.get("property_type"),bedrooms:optionalNumber("bedrooms"),bathrooms:optionalNumber("bathrooms"),area_sqm:optionalNumber("area_sqm"),expected_rent:optionalNumber("expected_rent"),currency:"USD",message:form.get("message"),consent:form.get("consent")==="on",website:form.get("website")||""});
  if(!details.success){setError("invalid");return;}if(!configured){setError("unavailable");return;}
  lock.current=true;setBusy(true);setProgress(0);const abort=new AbortController();controller.current=abort;
  const token=async()=>user?accountTask(async db=>{const result=await db.auth.getSession();if(result.error||!result.data.session)throw new Error("session");return result.data.session.access_token;}):undefined;
  const post=async<T,>(body:unknown):Promise<T>=>{const bearer=await token();const response=await fetchWithDeadline("/api/landlords",{method:"POST",signal:abort.signal,headers:{"Content-Type":"application/json",...(bearer?{Authorization:`Bearer ${bearer}`}:{})},body:JSON.stringify(body)},60000);const data=await response.json() as T&{error?:string};if(!response.ok)throw new Error(data.error||"connection");return data;};
  try{
   if(!prepared.current||prepared.current.expires<Date.now()){clearAttempt();prepared.current=await post<PreparedUpload>({action:"prepare",files:files.map(file=>({name:safeLandlordFilename(file.name),type:file.type,size:file.size})),website:""});}
   const attempt=prepared.current!;
   // A separate client has no persisted session or auth lock. Only the scoped,
   // two-hour upload capability can write these paths; it cannot read files.
   const storage=createClient(attempt.url,attempt.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetchWithDeadline(input,{...init,signal:abort.signal},60000)}}).storage.from(LANDLORD_BUCKET);
   for(let i=0;i<files.length;i++){
    const target=attempt.files[i];if(!uploaded.current.has(target.path)){
     const {error}=await storage.uploadToSignedUrl(target.path,target.token,files[i],{contentType:target.type,upsert:false});
     // A previous upload may have completed after its response was lost. The
     // finaliser checks actual size/type before it accepts an existing object.
     if(error&&!['409','Duplicate'].includes(String((error as {statusCode?:string;error?:string}).statusCode||(error as {error?:string}).error)))throw new Error("upload");
     uploaded.current.add(target.path);
    }if(mounted.current)setProgress(i+1);
   }
   const result=await post<{id:string}>({action:"finalize",permit:attempt.permit,details:details.data});
   if(mounted.current){setReceipt(result.id);setFiles([]);clearAttempt();}
  }catch(issue){if(mounted.current){const code=issue instanceof Error?issue.message:"connection";if(code==="expired")clearAttempt();setError(landlordErrors[code]?code:"connection");}}
  finally{lock.current=false;if(mounted.current)setBusy(false);}
 }
 if(receipt)return <div className="form-success" role="status"><span><Check size={26}/></span><h3>{t("Property introduction received","Đã nhận thông tin bất động sản")}</h3><p>{t("Gary Home will review your property and contact you. Your files are private; nothing has been published.","Gary Home sẽ xem xét bất động sản và liên hệ với bạn. Tệp được giữ riêng tư; chưa có nội dung nào được đăng.")}</p><p className="landlord-receipt">{t("Reference","Mã tiếp nhận")}: {receipt}</p>{user&&<Link className="text-link" href="/account">{t("View your linked enquiry","Xem yêu cầu liên hệ đã gửi")}<ArrowUpRight size={16}/></Link>}<button type="button" className="button button-outline" onClick={()=>setReceipt("")}>{t("Introduce another property","Giới thiệu bất động sản khác")}</button></div>;
 return <form className="enquiry-form landlord-form" onSubmit={submit}>
  <fieldset disabled={busy}><legend>{t("Your contact details","Thông tin liên hệ")}</legend><div className="form-row"><label>{t("Your name","Họ và tên")}<input name="owner_name" required minLength={2} maxLength={120} autoComplete="name" defaultValue={typeof user?.user_metadata?.full_name==="string"?user.user_metadata.full_name:""}/></label><label>{t("Email","Email")}<input type="email" name="email" required maxLength={254} autoComplete="email" defaultValue={user?.email||""}/></label></div><label>{t("Phone (optional)","Số điện thoại (tùy chọn)")}<input name="phone" type="tel" maxLength={40} autoComplete="tel"/></label></fieldset>
  <fieldset disabled={busy}><legend>{t("Property details","Thông tin bất động sản")}</legend><label>{t("Property address","Địa chỉ bất động sản")}<input name="address" required minLength={5} maxLength={300} autoComplete="street-address"/></label><div className="form-row"><label>{t("District / area","Quận / khu vực")}<SelectField name="district_slug" defaultValue=""><option value="">{t("Please confirm with me","Nhờ đội ngũ xác nhận")}</option>{content.neighbourhoods.map(area=><option key={area.slug} value={area.slug}>{area.name}</option>)}</SelectField></label><label>{t("Property type","Loại bất động sản")}<SelectField name="property_type" defaultValue="Apartment">{RENTAL_TYPES.map(type=><option key={type} value={type}>{typeLabel(type,language)}</option>)}</SelectField></label></div><div className="form-row"><label>{t("Bedrooms (0 for studio / office)","Phòng ngủ (0 cho studio / văn phòng)")}<input name="bedrooms" type="number" required min={0} max={50} step={1}/></label><label>{t("Bathrooms (optional)","Phòng tắm (tùy chọn)")}<input name="bathrooms" type="number" min={0} max={50} step={1}/></label></div><div className="form-row"><label>{t("Area · m² (optional)","Diện tích · m² (tùy chọn)")}<input name="area_sqm" type="number" min={0.01} max={99999999} step="0.01"/></label><label>{t("Asking rent · USD (optional)","Giá thuê mong muốn · USD (tùy chọn)")}<input name="expected_rent" type="number" min={0} max={999999999999} step="0.01"/></label></div><label>{t("Tell us about your property","Kể cho chúng tôi về nhà của bạn")}<textarea name="message" rows={5} required minLength={10} maxLength={4000} placeholder={t("Furniture, availability, included services and how you would like to arrange viewings…","Nội thất, tình trạng cho thuê, dịch vụ bao gồm và cách bạn muốn tổ chức xem nhà…")}/></label></fieldset>
  <fieldset disabled={busy}><legend>{t("Photos & plans (optional)","Ảnh & bản vẽ (tùy chọn)")}</legend><p className="field-help" id="landlord-file-help">{t("Up to 6 JPG, PNG, WebP, AVIF or PDF files. 5 MB per file, 25 MB total. Upload only property materials you have permission to share; avoid identity documents.","Tối đa 6 tệp JPG, PNG, WebP, AVIF hoặc PDF. Mỗi tệp tối đa 5 MB, tổng 25 MB. Chỉ gửi tài liệu bất động sản bạn được phép chia sẻ; tránh giấy tờ tùy thân.")}</p><label className="landlord-upload"><Upload size={23}/><span>{t("Choose photos or PDF plans","Chọn ảnh hoặc bản vẽ PDF")}</span><input aria-describedby="landlord-file-help" type="file" accept="image/jpeg,image/png,image/webp,image/avif,application/pdf" multiple onChange={event=>{chooseFiles(Array.from(event.target.files||[]));event.target.value="";}}/></label><ul className="landlord-file-list">{files.map((file,index)=><li key={index+file.name}><FilePreview file={file}/><span>{file.name}<small>{(file.size/1024/1024).toFixed(2)} MB</small></span><button type="button" disabled={busy} className="icon-button" aria-label={t("Remove file","Xóa tệp")+" · "+file.name} onClick={()=>{clearAttempt();setFiles(files.filter((_,i)=>i!==index));}}><X size={18}/></button></li>)}</ul></fieldset>
  <label className="honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off"/></label><label className="consent-label"><input type="checkbox" name="consent" required disabled={busy}/><span>{t("I agree to Gary Home reviewing these details and private files to respond to my request. See the","Tôi đồng ý để Gary Home xem thông tin và tệp riêng tư nhằm phản hồi yêu cầu. Xem")} <Link href="/privacy" target="_blank">{t("privacy policy","chính sách bảo mật")}</Link>.</span></label>
  {error&&<p className="form-error" role="alert">{t(...(landlordErrors[error]||landlordErrors.connection))}</p>}
  {busy&&<p className="form-info" role="status">{files.length&&progress<files.length?t(`Uploading file ${progress+1} of ${files.length}…`,`Đang tải tệp ${progress+1}/${files.length}…`):t("Saving your introduction…","Đang lưu thông tin giới thiệu…")}</p>}
  <button className="button" type="submit" disabled={busy||!configured}>{busy?t("Sending…","Đang gửi…"):t("Send property introduction","Gửi giới thiệu bất động sản")}<ArrowUpRight size={17}/></button>
  {!configured&&<p className="form-info">{t(...landlordErrors.unavailable)}</p>}
 </form>;
}
