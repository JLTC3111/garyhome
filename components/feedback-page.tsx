"use client";
import Link from "next/link";
import { useState } from "react";
import { MessageSquare, Star } from "lucide-react";
import { useSite } from "./site-context";
import { CustomerSubmissionForm } from "./customer-submission-form";
import { SubmissionHistory } from "./submission-history";
import { isPublicRental, listingCode } from "@/lib/rentals";
import type { PublicFeedback } from "@/lib/submissions";

export function FeedbackPage({reviews,unavailable=false}:{reviews:PublicFeedback[];unavailable?:boolean}){
 const {t,language,content,user}=useSite(),[version,setVersion]=useState(0);
 return <div className="container section feedback-page"><div className="feedback-intro"><div className="eyebrow">{t("WE’RE LISTENING","LẮNG NGHE BẠN")}</div><h1>{t("A better experience starts with you.","Trải nghiệm tốt hơn bắt đầu từ bạn.")}</h1><p>{t("Tell us about your experience finding a home with Gary Home. Your feedback helps us improve.","Chia sẻ trải nghiệm tìm nhà cùng Gary Home. Phản hồi của bạn giúp chúng tôi cải thiện dịch vụ.")}</p></div><div className="feedback-columns"><section className="submission-panel"><h2>{t("Share your feedback","Chia sẻ ý kiến của bạn")}</h2><CustomerSubmissionForm kind="feedback" onSent={()=>setVersion(v=>v+1)}/></section><section className="feedback-reviews" aria-labelledby="customer-feedback-heading"><h2 id="customer-feedback-heading">{t("From our customers","Phản hồi khách hàng")}</h2><p className="muted">{t("Published with permission, after moderation.","Được đăng với sự đồng ý của khách hàng và đã qua kiểm duyệt.")}</p>{unavailable?<p className="form-info" role="status">{t("Reviews could not be loaded. Please refresh or try again later.","Chưa thể tải đánh giá. Vui lòng tải lại hoặc thử sau.")}</p>:!reviews.length?<div className="feedback-empty"><MessageSquare size={28}/><h3>{t("Your voice belongs here.","Chúng tôi mong nghe ý kiến của bạn.")}</h3><p>{t("Approved customer reviews will appear here.","Đánh giá đã được duyệt sẽ xuất hiện tại đây.")}</p></div>:reviews.map(review=>{
 const property=content.properties.find(p=>p.id===review.property_id&&isPublicRental(p));
 return <article className="feedback-review" key={review.id}><div className="feedback-review-heading"><strong>{review.name}</strong><time dateTime={review.published_at}>{new Date(review.published_at).toLocaleDateString(language==="vi"?"vi-VN":"en-GB",{timeZone:"Asia/Ho_Chi_Minh"})}</time></div><div className="review-stars" role="img" aria-label={t(`${review.rating} out of 5 stars`,`${review.rating} trên 5 sao`)}>{[1,2,3,4,5].map(n=><Star key={n} size={16} fill={n<=review.rating?"currentColor":"none"} aria-hidden="true"/>)}</div><p>{review.message}</p>{property&&<Link className="text-link" href={`/homes/${property.slug}`}>{listingCode(property)}</Link>}{review.staff_reply&&<div className="feedback-staff-reply"><strong>Gary Home</strong><p>{review.staff_reply}</p></div>}</article>;
 })}<Link className="text-link" href="/activities?category=feedback">{t("View customer feedback screenshots","Xem hình ảnh phản hồi khách hàng")}</Link></section></div>{user&&<SubmissionHistory key={user.id+version}/>}</div>;
}
