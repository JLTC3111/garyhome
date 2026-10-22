"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { useSite } from "./site-context";
import { BlurFade } from "./magicui/blur-fade";
import { Disclosure } from "./motion-primitives/disclosure";

export function HomeFaq() {
  const { t } = useSite();
  const [open, setOpen] = useState<number | null>(0);
  const id = useId();
  const questions = [
    [t("How do I arrange a viewing?", "Làm thế nào để đặt lịch xem nhà?"), t("Open a home you like and request a viewing date. Our team will confirm the price, availability and a time with you. A request does not reserve the property.", "Mở căn nhà bạn thích và gửi ngày muốn xem. Đội ngũ sẽ xác nhận giá, tình trạng và thời gian cùng bạn. Yêu cầu xem nhà chưa phải là đặt giữ căn nhà.")],
    [t("Can I keep a shortlist?", "Tôi có thể lưu danh sách yêu thích không?"), t("Tap the heart on any home. As a guest, your shortlist stays on this browser. Sign in to save homes across devices; you can choose to import your browser shortlist from My account.", "Nhấn trái tim trên căn nhà bạn thích. Khi chưa đăng nhập, danh sách được lưu trên trình duyệt này. Đăng nhập để lưu trên nhiều thiết bị; bạn có thể chọn nhập danh sách từ trình duyệt trong Tài khoản của tôi.")],
    [t("What is included in the monthly rent?", "Tiền thuê hàng tháng bao gồm những gì?"), t("Included services, utilities and deposits vary by home. Ask the team for a breakdown of the rent, additional charges and lease terms before making a decision.", "Dịch vụ, điện nước và tiền cọc tùy từng căn nhà. Hãy nhờ đội ngũ làm rõ tiền thuê, phí bổ sung và điều khoản hợp đồng trước khi quyết định.")],
    [t("Moving to Hanoi and unsure where to start?", "Sắp chuyển đến Hà Nội và chưa biết bắt đầu từ đâu?"), t("Tell us your budget, preferred move-in date and what matters to your daily routine. We can help you explore neighbourhoods and put together a personal shortlist.", "Chia sẻ ngân sách, ngày dự kiến chuyển vào và những điều quan trọng trong sinh hoạt. Chúng tôi sẽ giúp bạn tìm hiểu khu vực và chọn danh sách nhà theo nhu cầu.")],
  ];

  return <section className="section container home-faq" aria-labelledby={`${id}-heading`}>
    <BlurFade className="faq-intro">
      <div className="eyebrow">{t("A LITTLE CLARITY", "GIẢI ĐÁP CÙNG BẠN")}</div>
      <h2 id={`${id}-heading`}>{t("Good questions.\nHonest answers.", "Câu hỏi thực tế.\nGiải đáp chân thành.")}</h2>
      <p>{t("A few things to know before you find your place.", "Một vài điều hữu ích trước khi bạn chọn tổ ấm.")}</p>
      <Link className="text-link" href="/contact">{t("Ask us anything", "Hỏi đội ngũ Gary")}<ArrowUpRight size={17}/></Link>
    </BlurFade>
    <div className="faq-items">{questions.map(([question, answer], index) => <div className={`faq-item ${open === index ? "is-open" : ""}`} key={index}>
      <h3><button id={`${id}-question-${index}`} type="button" aria-expanded={open === index} aria-controls={`${id}-answer-${index}`} onClick={() => setOpen(open === index ? null : index)}>
        <span>{question}</span><Plus size={19} aria-hidden="true"/>
      </button></h3>
      <Disclosure open={open === index} id={`${id}-answer-${index}`} labelledBy={`${id}-question-${index}`}><p>{answer}</p></Disclosure>
    </div>)}</div>
  </section>;
}
