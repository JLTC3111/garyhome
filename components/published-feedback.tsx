"use client";
import Link from "next/link";
import { MessageSquare,RefreshCw,Star } from "lucide-react";
import { useSite } from "./site-context";
import { usePublicFeedback } from "./use-public-feedback";
import { isPublicRental,listingCode } from "@/lib/rentals";
import type { PublicFeedback } from "@/lib/submissions";
export function PublishedFeedback({initialReviews=[],unavailable=false,compact=false}:{initialReviews?:PublicFeedback[];unavailable?:boolean;compact?:boolean}){
 const {t,language,content}=useSite(),{reviews,failed,refresh}=usePublicFeedback(initialReviews,unavailable,compact?6:50),Heading=compact?"h3":"h2";
 return <section className={`feedback-reviews ${compact?"homepage-feedback-reviews":""}`} aria-label={t("Published customer feedback","Phản hồi khách hàng đã đăng")}><Heading>{t("From our customers","Phản hồi khách hàng")}</Heading><p className="muted">{t("Published with permission, after moderation.","Được đăng với sự đồng ý của khách hàng và đã qua kiểm duyệt.")}</p>
  {failed&&<div className="form-info" role="status"><p>{t("Reviews could not be refreshed. Please try again.","Chưa thể cập nhật đánh giá. Vui lòng thử lại.")}</p><button className="text-link" type="button" onClick={refresh}><RefreshCw size={15}/>{t("Refresh reviews","Tải lại đánh giá")}</button></div>}
  {!reviews.length&&!failed&&<div className="feedback-empty"><MessageSquare size={28}/><Heading>{t("Your voice belongs here.","Chúng tôi mong nghe ý kiến của bạn.")}</Heading><p>{t("Approved customer reviews will appear here.","Đánh giá đã được duyệt sẽ xuất hiện tại đây.")}</p></div>}
  <div className="published-feedback-list">{reviews.map(review=>{const property=content.properties.find(item=>item.id===review.property_id&&isPublicRental(item));return <article className="feedback-review" key={review.id}><div className="feedback-review-heading"><strong>{review.name}</strong><time dateTime={review.published_at}>{new Date(review.published_at).toLocaleDateString(language==="vi"?"vi-VN":"en-GB",{timeZone:"Asia/Ho_Chi_Minh"})}</time></div><div className="review-stars" role="img" aria-label={t(`${review.rating} out of 5 stars`,`${review.rating} trên 5 sao`)}>{[1,2,3,4,5].map(star=><Star key={star} size={16} fill={star<=review.rating?"currentColor":"none"} aria-hidden="true"/>)}</div><p>{review.message}</p>{property&&<Link className="text-link" href={`/homes/${property.slug}`}>{listingCode(property)}</Link>}{review.staff_reply&&<div className="feedback-staff-reply"><strong>Gary Home</strong><p>{review.staff_reply}</p></div>}</article>;})}</div>
  {compact&&<Link className="text-link" href="/feedback">{t("Read or share feedback","Đọc hoặc gửi phản hồi")}</Link>}
 </section>;
}
