"use client";
import { ContentImage } from "./content-image";
import Link from "next/link";
import { ArrowUpRight, Building2 } from "lucide-react";
import { useSite } from "./site-context";
import { PropertyGallery } from "./property-gallery";
import { projectRent, projectSummary, vinhomesProjects } from "@/lib/vinhomes";

export function VinhomesCollection() {
  const { t, language } = useSite();
  return <section className="section container vinhomes-collection" aria-labelledby="vinhomes-collection-heading">
    <div className="section-heading"><div><div className="eyebrow">VINHOMES · GARY HOME</div>
      <h2 id="vinhomes-collection-heading">{t("A home in a Vinhomes community.", "Tổ ấm trong cộng đồng Vinhomes.")}</h2>
      <p>{t("Explore Gardenia, Skylake and Smart City through our newly added rental collection.", "Khám phá Gardenia, Skylake và Smart City qua bộ sưu tập nhà cho thuê mới bổ sung.")}</p>
    </div><Link className="text-link" href="/vinhomes">{t("Explore the collection", "Khám phá bộ sưu tập")}<ArrowUpRight size={18}/></Link></div>
    <div className="vinhomes-collection-grid">{vinhomesProjects.map(project => <article key={project.slug} className="vinhomes-card">
      <Link href={`/vinhomes#${project.slug}`} className="vinhomes-card-cover" aria-label={t(`Explore ${project.name}`, `Khám phá ${project.name}`)}><ContentImage src={project.images[0]} alt={t(`Apartment interior at ${project.name}`, `Không gian căn hộ tại ${project.name}`)} width={720} height={540} sizes="(max-width: 700px) 100vw, (max-width: 1000px) 50vw, 33vw" loading="lazy"/></Link>
      <div className="vinhomes-card-body"><div className="eyebrow">{project.location[language === "vi" ? 1 : 0]}</div>
        <h3><Link href={`/vinhomes#${project.slug}`}>{project.name}</Link></h3><p>{projectSummary(project, language)}</p>
        <p className="vinhomes-rent">{projectRent(project, language)}<small> / {t("month", "tháng")}</small></p>
        <Link className="text-link" href={`/vinhomes#${project.slug}`}>{t("Photos & rental details", "Ảnh & thông tin thuê")}<ArrowUpRight size={16}/></Link>
      </div>
    </article>)}</div>
    <p className="vinhomes-collection-note">{t("Indicative rents from the supplied property notes. Ask Gary Home to confirm availability, rent and lease terms.", "Giá tham khảo theo thông tin căn hộ được cung cấp. Liên hệ Gary Home để xác nhận tình trạng, giá và điều kiện thuê.")}</p>
  </section>;
}

export function VinhomesPage() {
  const { t, language } = useSite();
  return <div className="container section vinhomes-page">
    <nav className="about-breadcrumb" aria-label={t("Breadcrumb", "Đường dẫn")}><Link href="/">{t("Home", "Trang chủ")}</Link><span aria-hidden="true">/</span><span>Vinhomes</span></nav>
    <div className="page-intro"><div className="eyebrow">VINHOMES · GARY HOME</div><h1>{t("Three communities.\nYour next Hanoi home.", "Ba cộng đồng.\nTổ ấm tiếp theo tại Hà Nội.")}</h1>
      <p>{t("A closer look at the homes in our Gardenia, Skylake and Smart City collection, with photographs and details supplied for each apartment.", "Tìm hiểu các căn hộ trong bộ sưu tập Gardenia, Skylake và Smart City, với ảnh và thông tin được cung cấp cho từng căn.")}</p>
    </div>
    <nav className="vinhomes-project-links popular-search" aria-label={t("Vinhomes projects", "Các dự án Vinhomes")}>{vinhomesProjects.map(p => <a href={`#${p.slug}`} key={p.slug}>{p.name}</a>)}</nav>
    {vinhomesProjects.map(project => <article key={project.slug} id={project.slug} className="vinhomes-project" aria-labelledby={`project-${project.slug}`}>
      <header><div><div className="eyebrow">{project.location[language === "vi" ? 1 : 0]}</div><h2 id={`project-${project.slug}`}>{project.name}</h2><p>{projectSummary(project, language)}{project.reference ? ` · ${project.reference}` : ""}</p></div><Building2 size={32} aria-hidden="true"/></header>
      <PropertyGallery images={project.images} title={`${project.name} · ${project.building}`}/>
      <div className="vinhomes-project-details"><dl className="vinhomes-project-facts">
        <div><dt>{t("Building", "Tòa nhà")}</dt><dd>{project.building}</dd></div>
        <div><dt>{t("Bedrooms", "Phòng ngủ")}</dt><dd>{project.bedrooms}{project.bedroomPlus ? "+" : ""}</dd></div>
        {project.bathrooms && <div><dt>{t("Bathrooms", "Phòng tắm")}</dt><dd>{project.bathrooms}</dd></div>}
        {project.areaSqm && <div><dt>{t("Floor area", "Diện tích")}</dt><dd>{project.areaSqm} m²</dd></div>}
        {project.leaseMonths && <div><dt>{t("Lease in supplied notes", "Kỳ hạn theo thông tin cung cấp")}</dt><dd>{project.leaseMonths} {t("months", "tháng")}</dd></div>}
        <div><dt>{t("Deposit", "Đặt cọc")}</dt><dd>{project.depositMonths} {t("month’s rent", "tháng tiền thuê")}</dd></div>
        <div><dt>{t("Rent payment", "Thanh toán tiền thuê")}</dt><dd>{t(`Every ${project.paymentMonths} months`, `${project.paymentMonths} tháng/lần`)}</dd></div>
        {project.reference && <div><dt>{t("Property reference", "Mã căn hộ")}</dt><dd>{project.reference}</dd></div>}
      </dl><aside className="vinhomes-project-enquiry"><strong>{projectRent(project, language)} / {t("month", "tháng")}</strong>
        <p>{t("Indicative rent from the supplied notes. Confirm availability, included services and current lease terms with the team.", "Giá tham khảo theo thông tin được cung cấp. Xác nhận tình trạng, dịch vụ bao gồm và điều kiện thuê hiện tại với đội ngũ.")}</p>
        <Link className="button" href={`/contact?project=${project.slug}`}>{t("Ask about this apartment", "Hỏi về căn hộ này")}<ArrowUpRight size={17}/></Link>
      </aside></div>
    </article>)}
  </div>;
}
