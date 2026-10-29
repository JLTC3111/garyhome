import type { Language, Property, Neighbourhood } from "./types";
import { isPublicRental, propertyTitle } from "./rentals.ts";

import { publicArticles, articleText, type EditorialArticle } from "./editorial.ts";

type TitleProperty = Property;
const pageTitles: Record<string, readonly [string, string]> = {
  "/homes": ["Hanoi rental properties", "Bất động sản cho thuê Hà Nội"],
  "/cart": ["My Favourites", "Nhà yêu thích"],
  "/activities": ["Our activities", "Hoạt động của chúng tôi"],
  "/feedback": ["Feedback", "Phản hồi"],
  "/saved": ["Your saved homes", "Nhà đã lưu"],
  "/neighbourhoods": ["Find your kind of Hanoi", "Tìm khu phố dành cho bạn"],
  "/services": ["Other Services", "Other Services"],
  "/vinhomes": ["Vinhomes rental collection in Hanoi", "Bộ sưu tập căn hộ Vinhomes cho thuê tại Hà Nội"],
  "/tips-and-news": ["Tips & News", "Cẩm nang & tin tức"],
  "/landlords": ["For landlords", "Dành cho chủ nhà"],
  "/contact": ["Contact us", "Liên hệ"],
  "/login": ["Choose your login portal", "Chọn cổng đăng nhập"],
  "/account": ["Customer Portal", "Cổng khách hàng"],
  "/admin": ["Staff Portal · Gary Home Studio", "Cổng nhân viên · Gary Home Studio"],
  "/auth/callback": ["Email verification", "Xác minh email"],
  "/auth/invite": ["Join the Gary Home team", "Gia nhập đội ngũ Gary Home"],
  "/auth/reset": ["Reset your password", "Đặt lại mật khẩu"],
  "/privacy": ["Privacy", "Chính sách bảo mật"],
  "/credits": ["Photo credits", "Nguồn ảnh"],
};

export function documentTitle(pathname: string | null, language: Language, properties: readonly TitleProperty[],neighbourhoods: readonly Pick<Neighbourhood,"slug"|"name">[] = [], articles?: readonly EditorialArticle[]): string | null {
  // The router can briefly have no pathname while restoring a route.
  if (pathname === null) return null;
  const path = pathname.replace(/\/+$/, "") || "/";
  const vi = language === "vi";
  if (path === "/") return vi ? "Căn hộ dịch vụ cho thuê tại Hà Nội | Gary Home" : "Serviced apartments in Hanoi for rent | Gary Home";
  const page = pageTitles[path];
  if (page) return `${page[vi ? 1 : 0]} | Gary Home`;

  const guide=publicArticles(articles).find(item=>path==="/tips-and-news/"+item.slug);if(guide)return `${articleText(guide,"title",language)} | Gary Home`;
  const match = /^\/homes\/([^/]+)$/.exec(path);
  if (match) {
    let slug: string;
    try { slug = decodeURIComponent(match[1]); } catch { slug = ""; }
    // Match the public detail page, even when Studio has loaded private drafts.
    const property = properties.find(item => item.slug === slug && isPublicRental(item));
    if (!property) return `${vi ? "Không tìm thấy căn nhà" : "Home not found"} | Gary Home`;
    return `${propertyTitle(property,language,neighbourhoods.find(n=>n.slug===property.district_slug)?.name)} | Gary Home`;
  }
  return `${vi ? "Không tìm thấy trang" : "Page not found"} | Gary Home`;
}
