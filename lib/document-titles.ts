import type { Language, Property } from "./types";

type TitleProperty = Pick<Property, "slug" | "title_en" | "title_vi" | "status" | "availability">;
const pageTitles: Record<string, readonly [string, string]> = {
  "/homes": ["Explore Hanoi homes", "Khám phá nhà tại Hà Nội"],
  "/saved": ["Your saved homes", "Nhà đã lưu"],
  "/neighbourhoods": ["Find your kind of Hanoi", "Tìm khu phố dành cho bạn"],
  "/about": ["The Gary way", "Về Gary Home"],
  "/contact": ["Contact us", "Liên hệ"],
  "/login": ["Choose your login portal", "Chọn cổng đăng nhập"],
  "/account": ["Customer Portal", "Cổng khách hàng"],
  "/admin": ["Staff Portal · Gary Home Studio", "Cổng nhân viên · Gary Home Studio"],
  "/auth/invite": ["Join the Gary Home team", "Gia nhập đội ngũ Gary Home"],
  "/auth/reset": ["Reset your password", "Đặt lại mật khẩu"],
  "/privacy": ["Privacy", "Chính sách bảo mật"],
  "/credits": ["Photo credits", "Nguồn ảnh"],
};

export function documentTitle(pathname: string | null, language: Language, properties: readonly TitleProperty[]): string | null {
  // The router can briefly have no pathname while restoring a route.
  if (pathname === null) return null;
  const path = pathname.replace(/\/+$/, "") || "/";
  const vi = language === "vi";
  if (path === "/") return vi ? "Gary Home — Tìm tổ ấm tại Hà Nội" : "Gary Home — Find your place in Hanoi";
  const page = pageTitles[path];
  if (page) return `${page[vi ? 1 : 0]} | Gary Home`;

  const match = /^\/homes\/([^/]+)$/.exec(path);
  if (match) {
    let slug: string;
    try { slug = decodeURIComponent(match[1]); } catch { slug = ""; }
    // Match the public detail page, even when Studio has loaded private drafts.
    const property = properties.find(item => item.slug === slug && item.status === "published" && !["rented", "sold"].includes(item.availability));
    if (!property) return `${vi ? "Không tìm thấy căn nhà" : "Home not found"} | Gary Home`;
    const preferred = vi ? property.title_vi : property.title_en;
    const fallback = vi ? property.title_en : property.title_vi;
    const title = preferred.trim() || fallback.trim() || (vi ? "Thông tin căn nhà" : "Home details");
    return `${title.replace(/\s+/g, " ")} | Gary Home`;
  }
  return `${vi ? "Không tìm thấy trang" : "Page not found"} | Gary Home`;
}
