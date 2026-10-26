"use client";
import Link from "next/link";
import { useState } from "react";
import { PublishedFeedback } from "./published-feedback";
import { useSite } from "./site-context";
import { CustomerSubmissionForm } from "./customer-submission-form";
import { SubmissionHistory } from "./submission-history";
import type { PublicFeedback } from "@/lib/submissions";

export function FeedbackPage({reviews,unavailable=false}:{reviews:PublicFeedback[];unavailable?:boolean}){
 const {t,user}=useSite(),[version,setVersion]=useState(0);
 return <div className="container section feedback-page"><div className="feedback-intro"><div className="eyebrow">{t("WE’RE LISTENING","LẮNG NGHE BẠN")}</div><h1>{t("A better experience starts with you.","Trải nghiệm tốt hơn bắt đầu từ bạn.")}</h1><p>{t("Tell us about your experience finding a home with Gary Home. Your feedback helps us improve.","Chia sẻ trải nghiệm tìm nhà cùng Gary Home. Phản hồi của bạn giúp chúng tôi cải thiện dịch vụ.")}</p></div><div className="feedback-columns"><section className="submission-panel"><h2>{t("Share your feedback","Chia sẻ ý kiến của bạn")}</h2><CustomerSubmissionForm kind="feedback" onSent={()=>setVersion(v=>v+1)}/></section><div><PublishedFeedback initialReviews={reviews} unavailable={unavailable}/><Link className="text-link" href="/activities?category=feedback">{t("View customer feedback screenshots","Xem hình ảnh phản hồi khách hàng")}</Link></div></div>{user&&<SubmissionHistory key={user.id+version}/>}</div>;
}
