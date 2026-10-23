import type { Language, Property } from "./types";

export const RENTAL_TYPES = ["Apartment", "Villa/Duplex", "Office & Restaurant", "Vinhomes"] as const;
export const AMENITIES: Record<string, readonly [string, string]> = {
  Balcony:["Balcony","Ban công"], Bathtub:["Bathtub","Bồn tắm"], "Air conditioning":["Air conditioning","Điều hòa"],
  "Equipped kitchen":["Equipped kitchen","Bếp đầy đủ thiết bị"], "Lake view":["Lake view","Tầm nhìn hồ"],
  Microwave:["Microwave","Lò vi sóng"], "Washing machine":["Washing machine","Máy giặt"], Dryer:["Dryer","Máy sấy"],
  Curtains:["Curtains","Rèm cửa"], TV:["TV","TV"], "Cable TV":["Cable TV","Truyền hình cáp"], Refrigerator:["Refrigerator","Tủ lạnh"],
  "Wi-Fi":["Wi-Fi","Wi-Fi"], "Pet friendly":["Pet friendly","Cho phép thú cưng"], Gym:["Gym","Phòng tập"], Sauna:["Sauna","Phòng xông hơi"],
  Parking:["Parking","Chỗ đỗ xe"], Elevator:["Elevator","Thang máy"], "Swimming pool":["Swimming pool","Bể bơi"],
};
export function amenityLabel(value: string, language: Language) { return AMENITIES[value]?.[language === "vi" ? 1 : 0] ?? value; }
export function typeLabel(value: string, language: Language) {
  const labels:Record<string,readonly[string,string]>={Apartment:["Apartment","Căn hộ"],Studio:["Studio apartment","Căn hộ studio"],"House & Villa":["Villa / Duplex","Biệt thự / Duplex"],"Villa/Duplex":["Villa / Duplex","Biệt thự / Duplex"],"Office & Restaurant":["Office & Restaurant","Văn phòng & Nhà hàng"],Vinhomes:["Vinhomes","Vinhomes"]};
  return labels[value]?.[language === "vi" ? 1 : 0] ?? value;
}
export function isPublicRental(p: Pick<Property,"listing_type"|"status"|"availability">) {
  return p.listing_type === "rent" && p.status === "published" && ["available","on_request"].includes(p.availability);
}
export function rentalTermLabel(term: Property["rental_term"], language: Language) {
  const labels={short:["Short-term","Ngắn hạn"],long:["Long-term","Dài hạn"],both:["Short & long-term","Ngắn & dài hạn"],on_request:["Lease length to confirm","Xác nhận thời hạn thuê"]};
  return labels[term || "on_request"][language === "vi" ? 1 : 0];
}
export function listingCode(p: Pick<Property,"id"|"listing_code">) { return p.listing_code || p.id; }
export function propertyTitle(p: Property, language: Language, district?: string, withFeatures = true) {
  const location = district || p.address;
  const type = typeLabel(p.property_type, language);
  const commercial=p.property_type==="Office & Restaurant";
  const rooms = commercial ? "" : p.bedrooms === 0 ? (language === "vi" ? "studio" : "studio") : (language === "vi" ? `${p.bedrooms} phòng ngủ` : `${p.bedrooms}-bedroom`);
  const englishType=p.property_type==="Vinhomes"?type:type.toLowerCase();
  const residentialType=p.bedrooms===0&&p.property_type==="Studio"?(language==="vi"?"Căn hộ":"apartment"):type;
  const base = language === "vi" ? `${residentialType}${rooms?` ${rooms}`:""} cho thuê tại ${location}` : `${rooms?rooms[0].toUpperCase()+rooms.slice(1)+" ":""}${commercial?type:p.bedrooms===0&&p.property_type==="Studio"?"apartment":englishType} for rent in ${location}`;
  const area = p.area_sqm !== null ? `${Number(p.area_sqm).toLocaleString(language === "vi" ? "vi-VN" : "en-US")} m²` : "";
  const features = withFeatures ? (p.seo_features?.length ? p.seo_features : p.amenities.filter(a=>["Balcony","Lake view","Pet friendly"].includes(a))).filter(a=>p.amenities.includes(a)).slice(0,2).map(a=>amenityLabel(a,language)) : [];
  return [base,area,...features].filter(Boolean).join(" · ");
}
export function channelUrl(kind:"whatsapp"|"zalo", phone:string, text="") {
  let digits=phone.replace(/\D/g,"");
  if(kind==="whatsapp"&&/^0[35789]\d{8}$/.test(digits))digits="84"+digits.slice(1);
  if(kind==="zalo"&&/^84[35789]\d{8}$/.test(digits))digits="0"+digits.slice(2);
  if(!/^\d{8,15}$/.test(digits))return "";
  return kind==="whatsapp" ? `https://wa.me/${digits}${text?`?text=${encodeURIComponent(text)}`:""}` : `https://zalo.me/${digits}`;
}
