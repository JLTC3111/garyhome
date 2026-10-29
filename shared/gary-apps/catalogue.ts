export type GaryAppId = "home" | "jobs" | "visa";
export type GaryLanguage = "en" | "vi";
export type GaryCopy = { en: string; vi: string };
export type GaryApp = {
  id: GaryAppId; name: string; url: string; host: string;
  headline: GaryCopy; description: GaryCopy; shortDescription: GaryCopy;
  services: { label: GaryCopy; path: string }[];
};

// Shared, public information only. Keep URLs here rather than in individual pages.
export const GARY_APPS: readonly GaryApp[] = [
  {
    id: "home", name: "Gary Home", url: "https://garyhome.vn/", host: "garyhome.vn",
    headline: { en: "Find a place to call home.", vi: "Tìm nơi để gọi là nhà." },
    description: { en: "Explore serviced apartments and rentals in Hanoi. Save your shortlist and arrange a viewing with the team.", vi: "Khám phá căn hộ dịch vụ và nhà cho thuê tại Hà Nội. Lưu danh sách yêu thích và sắp xếp lịch xem cùng đội ngũ." },
    shortDescription: { en: "Apartments, rentals & viewings in Hanoi", vi: "Căn hộ, nhà cho thuê & lịch xem tại Hà Nội" },
    services: [
      { label: { en: "Browse rental homes", vi: "Tìm nhà cho thuê" }, path: "/homes" },
      { label: { en: "Arrange a viewing", vi: "Sắp xếp lịch xem nhà" }, path: "/contact" },
      { label: { en: "Introduce your property", vi: "Giới thiệu bất động sản" }, path: "/landlords" },
    ],
  },
  {
    id: "jobs", name: "Gary Jobs", url: "https://jobs.garyhome.vn/", host: "jobs.garyhome.vn",
    headline: { en: "Find your next teaching role.", vi: "Tìm công việc giảng dạy tiếp theo." },
    description: { en: "Discover English-teaching opportunities across Vietnam, connect with the recruitment team and explore life beyond the classroom.", vi: "Khám phá cơ hội giảng dạy tiếng Anh khắp Việt Nam, kết nối đội ngũ tuyển dụng và tìm hiểu cuộc sống ngoài lớp học." },
    shortDescription: { en: "Teaching jobs, recruitment & life in Vietnam", vi: "Việc làm giảng dạy, tuyển dụng & cuộc sống Việt Nam" },
    services: [
      { label: { en: "Explore teaching jobs", vi: "Khám phá việc làm giảng dạy" }, path: "/#opportunities" },
      { label: { en: "Travel & local life", vi: "Du lịch & cuộc sống địa phương" }, path: "/#life" },
      { label: { en: "Contact the recruitment team", vi: "Liên hệ đội ngũ tuyển dụng" }, path: "/#contact" },
    ],
  },
  {
    id: "visa", name: "Gary Visa Service", url: "https://visa.garyhome.vn/", host: "visa.garyhome.vn",
    headline: { en: "Get support for your next step.", vi: "Được hỗ trợ cho bước tiếp theo." },
    description: { en: "Find guidance on visas, work permits, residence cards and supporting documents for your plans in Vietnam.", vi: "Tìm sự hỗ trợ về visa, giấy phép lao động, thẻ tạm trú và hồ sơ cần thiết cho kế hoạch tại Việt Nam." },
    shortDescription: { en: "Visas, work permits & document support", vi: "Visa, giấy phép lao động & hỗ trợ hồ sơ" },
    services: [
      { label: { en: "Visa & e-visa support", vi: "Hỗ trợ visa & thị thực điện tử" }, path: "/#services" },
      { label: { en: "Work permits & residence cards", vi: "Giấy phép lao động & thẻ tạm trú" }, path: "/#services" },
      { label: { en: "Documents & translation", vi: "Hồ sơ & dịch thuật" }, path: "/#services" },
    ],
  },
];

export const GARY_GOALS = [
  { id: "home", app: "home", path: "/homes", label: { en: "Find a home", vi: "Tìm nhà" } },
  { id: "jobs", app: "jobs", path: "/#opportunities", label: { en: "Find a job", vi: "Tìm việc làm" } },
  { id: "visa", app: "visa", path: "/#services", label: { en: "Obtain a visa", vi: "Hỗ trợ xin visa" } },
  { id: "travel", app: "jobs", path: "/#life", label: { en: "Explore Vietnam", vi: "Du lịch Việt Nam" } },
] as const;

export function garyAppHref(appId: GaryAppId, path = "/", currentApp?: GaryAppId) {
  const app = GARY_APPS.find(app => app.id === appId);
  if (!app) throw new Error("Unknown Gary app");
  const target = new URL(path, app.url);
  if (target.origin !== new URL(app.url).origin) throw new Error("Service links must stay on the chosen Gary site");
  return appId === currentApp ? target.pathname + target.search + target.hash : target.href;
}
