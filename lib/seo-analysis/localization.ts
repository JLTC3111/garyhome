import type { Finding, Severity } from "./types.ts";
import { localizeFinding, findingLabel } from "../../shared/cms-foundation/seo-findings.js";
const ui = {
  english: ["English", "Tiếng Anh"], vietnamese: ["Vietnamese", "Tiếng Việt"],
  category: ["Content SEO", "SEO nội dung"], liveLabel: ["Live content SEO analysis", "Phân tích SEO nội dung trực tiếp"], liveTitle: ["Live SEO review", "Kiểm tra SEO trực tiếp"],
  methodology: ["Score = round(100 × passed applicable checks / evaluated applicable checks). Recommendations are unscored. This is not a ranking prediction; published technical checks run separately.", "Điểm = làm tròn(100 × tiêu chí phù hợp đạt / tiêu chí phù hợp đã đánh giá). Đề xuất không tính điểm. Điểm không dự đoán thứ hạng; kiểm tra kỹ thuật trang đã đăng được thực hiện riêng."],
  contentLanguage: ["Content language", "Ngôn ngữ nội dung"], focusTopic: ["Focus topic · optional", "Chủ đề trọng tâm · tùy chọn"], focusPlaceholder: ["For review only; never saved to content", "Chỉ kiểm tra; không lưu vào nội dung"],
  searchPreview: ["Search preview", "Xem trước tìm kiếm"], previewDevice: ["Preview device", "Thiết bị xem trước"], desktop: ["Desktop", "Máy tính"], mobile: ["Mobile", "Điện thoại"],
  titlePlaceholder: ["Your page title", "Tiêu đề trang"], descriptionPlaceholder: ["Add a description to preview the page summary.", "Thêm mô tả để xem trước phần tóm tắt trang."],
  previewNote: ["Illustrative preview. Google may rewrite titles and snippets. Appearance and truncation vary by query and device.", "Xem trước minh họa. Google có thể thay đổi tiêu đề và đoạn trích; cách hiển thị và rút gọn tùy truy vấn và thiết bị."],
  titleCharacters: ["title characters", "ký tự tiêu đề"], descriptionCharacters: ["description characters", "ký tự mô tả"], wordSegments: ["word segments", "đơn vị từ"], suggestedAction: ["Suggested action", "Gợi ý xử lý"],
  reviewNote: ["This panel never changes content or metadata. Clarity, intent, image meaning and factual accuracy need editorial review.", "Bảng này không thay đổi nội dung hoặc siêu dữ liệu. Cần biên tập viên kiểm tra độ rõ ràng, mục đích, ý nghĩa ảnh và tính chính xác."],
  scoreLabel: ["Content SEO check pass percentage", "Tỷ lệ tiêu chí SEO nội dung đạt"],
  critical: ["Critical", "Nghiêm trọng"], warning: ["Warning", "Cảnh báo"], recommendation: ["Recommendation", "Đề xuất"], passed: ["Passed", "Đạt"],
  summaryOnly: ["Summary only", "Chỉ bản tóm tắt"], fullReport: ["Full report", "Báo cáo đầy đủ"],
} as const;
export type SeoTextKey = keyof typeof ui;
export function seoText(key: SeoTextKey, language: string) { return ui[key][language === "vi" ? 1 : 0]; }
export function seoSeverity(severity: Severity, language: string) { return findingLabel(severity, language); }
export const localizeContentFinding = (finding: Finding, language: string): Finding => localizeFinding(finding, language);
