import type { Finding, Severity } from "./types.ts";

// Stable rule and UI keys keep authored content, URLs and raw evidence out of
// translation. English findings remain the canonical stored audit evidence.
type RuleCopy = readonly [title: string, explanation: string, recommendation: string];
const vietnameseRules: Record<string, RuleCopy> = {
  "content-title.passed": ["Đã có tiêu đề", "Tiêu đề giúp người đọc hiểu nội dung trang trước khi mở.", "Kiểm tra tiêu đề có mô tả chính xác trang cụ thể này hay không."],
  "content-title.warning": ["Thêm tiêu đề mô tả rõ nội dung", "Tiêu đề giúp người đọc hiểu nội dung trang trước khi mở.", "Viết tiêu đề riêng, nêu chủ đề và mục đích của trang."],
  "content-title-specific.recommendation": ["Làm rõ chủ đề trong tiêu đề", "Tiêu đề còn chung chung; người tìm kiếm có thể chưa hiểu chủ đề của trang.", "Nêu dịch vụ, địa điểm hoặc câu hỏi mà trang giải đáp."],
  "content-title-preview.recommendation": ["Kiểm tra phần tiêu đề có thể bị cắt", "Tiêu đề dài có thể bị rút gọn tùy thiết bị và độ rộng ký tự. Không có độ dài cố định để xếp hạng.", "Xem bản xem trước trên máy tính và điện thoại; đặt nội dung phân biệt trang ở đầu tiêu đề."],
  "content-description.passed": ["Đã có mô tả", "Mô tả có thể được dùng làm đoạn trích tìm kiếm. Công cụ tìm kiếm có thể chọn nội dung khác.", "Đảm bảo phần tóm tắt đúng với nội dung trang và giúp người đọc quyết định truy cập."],
  "content-description.warning": ["Thêm mô tả hữu ích", "Mô tả có thể được dùng làm đoạn trích tìm kiếm. Công cụ tìm kiếm có thể chọn nội dung khác.", "Tóm tắt những gì khách truy cập sẽ tìm thấy dựa trên nội dung thực tế của trang."],
  "content-description-preview.recommendation": ["Kiểm tra phần mô tả có thể bị cắt", "Không gian hiển thị đoạn trích thay đổi theo thiết bị và truy vấn; mô tả này có thể bị rút gọn.", "Đặt thông tin quan trọng trước. Không xóa chi tiết hữu ích chỉ để đạt một số lượng ký tự."],
  "content-body.passed": ["Đã có nội dung chính", "Người đọc cần nội dung hiển thị giải đáp đúng mục đích của trang.", "Kiểm tra độ chính xác, tính nguyên bản và khả năng giải đáp câu hỏi chính của người đọc."],
  "content-body.warning": ["Thêm nội dung chính", "Người đọc cần nội dung hiển thị giải đáp đúng mục đích của trang.", "Bổ sung nội dung hữu ích trước khi xuất bản."],
  "content-heading.passed": ["Đã có tiêu đề chính", "Tiêu đề chính hiển thị giúp người đọc nhận biết chủ đề của trang.", "Giữ tiêu đề chính rõ nghĩa và nhất quán với tiêu đề tìm kiếm."],
  "content-heading.warning": ["Thêm tiêu đề chính rõ ràng", "Tiêu đề chính hiển thị giúp người đọc nhận biết chủ đề của trang.", "Thêm tiêu đề chính mô tả chính xác trang này."],
  "content-heading-order.passed": ["Cấu trúc tiêu đề nhất quán", "Tiêu đề trống hoặc nhảy cấp có thể khiến tài liệu khó điều hướng.", "Dùng tiêu đề để mô tả chủ đề của từng phần."],
  "content-heading-order.warning": ["Kiểm tra cấu trúc tiêu đề", "Tiêu đề trống hoặc nhảy cấp có thể khiến tài liệu khó điều hướng.", "Điền các tiêu đề trống và sắp xếp các mục con theo thứ bậc hợp lý."],
  "content-multiple-h1.recommendation": ["Kiểm tra nhiều tiêu đề chính", "Một trang có thể có nhiều tiêu đề H1, nhưng chủ đề chính vẫn cần rõ ràng.", "Kiểm tra người đọc có dễ nhận biết chủ đề chính của trang hay không."],
  "content-image-alt.passed": ["Ảnh đã có thuộc tính alt", "Ảnh cung cấp thông tin cần văn bản thay thế. Thuộc tính alt rỗng hợp lệ cho ảnh trang trí.", "Kiểm tra mô tả có truyền đạt mục đích của từng ảnh hay không; ảnh trang trí có thể để alt rỗng."],
  "content-image-alt.warning": ["Ảnh thiếu thuộc tính alt", "Ảnh cung cấp thông tin cần văn bản thay thế. Thuộc tính alt rỗng hợp lệ cho ảnh trang trí.", "Mô tả các ảnh có thông tin và đặt thuộc tính alt rỗng rõ ràng cho ảnh trang trí."],
  "content-image-alt-quality.recommendation": ["Thay mô tả ảnh chung chung", "Những từ chung chung không truyền đạt thông tin trong ảnh.", "Mô tả chi tiết có ý nghĩa trong ảnh, không chèn từ khóa không liên quan."],
  "content-internal-links.recommendation": ["Cân nhắc liên kết nội bộ phù hợp", "Liên kết theo ngữ cảnh có thể giúp người đọc tìm thông tin liên quan. Không yêu cầu số liên kết cố định cho mỗi trang.", "Liên kết đến dịch vụ, bài viết hoặc tin đăng liên quan khi có ích cho người đọc."],
  "content-link-text.passed": ["Liên kết nội bộ có nhãn mô tả", "Nhãn liên kết cần giải thích đích đến trong ngữ cảnh. Liên kết dùng biểu tượng hoặc ảnh cũng cần tên hỗ trợ tiếp cận.", "Giữ liên kết phù hợp với nội dung xung quanh."],
  "content-link-text.warning": ["Kiểm tra nhãn liên kết nội bộ", "Nhãn liên kết cần giải thích đích đến trong ngữ cảnh. Liên kết dùng biểu tượng hoặc ảnh cũng cần tên hỗ trợ tiếp cận.", "Dùng nhãn nêu rõ đích đến hoặc mô tả ảnh hỗ trợ tiếp cận."],
  "content-repeated-paragraph.warning": ["Phát hiện đoạn văn lặp lại", "Một đoạn văn giống hệt xuất hiện nhiều lần trong nội dung chính.", "Kiểm tra việc lặp lại có chủ đích hay không; gộp các đoạn bị lặp ngoài ý muốn."],
  "content-readability.recommendation": ["Kiểm tra độ rõ ràng và phù hợp", "Số đơn vị từ và câu theo ngôn ngữ chỉ cung cấp ngữ cảnh, không phải điểm chất lượng hay thứ hạng.", "Đọc trang bằng ngôn ngữ mục tiêu. Giải thích thuật ngữ lạ, chia đoạn khó đọc, kiểm chứng thông tin và giải đáp nhu cầu của người đọc."],
  "content-focus-topic.recommendation": ["Kiểm tra mức độ bao quát chủ đề trọng tâm", "Cụm từ chính xác có thể khác từ đồng nghĩa hoặc biến thể vẫn diễn đạt tốt chủ đề.", "Dùng chủ đề một cách tự nhiên khi hữu ích. Tránh lặp ép buộc và mục tiêu mật độ từ khóa."],
};

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
export function seoSeverity(severity: Severity, language: string) { return seoText(severity, language); }
export function localizeContentFinding(finding: Finding, language: string): Finding {
  if (language !== "vi") return finding;
  const copy = vietnameseRules[`${finding.messageKey || finding.id}.${finding.severity}`];
  if (!copy) return finding;
  const values = finding.messageValues;
  let [title, explanation] = copy;
  const recommendation = copy[2];
  let evidence = finding.evidence;
  if (finding.id === "content-title-preview" && values?.characters !== undefined) evidence = `${values.characters} ký tự`;
  if (finding.id === "content-readability" && values?.words !== undefined && values.sentences !== undefined) explanation = `Phát hiện ${values.words} đơn vị từ và ${values.sentences} câu theo ngôn ngữ. Các số đếm này cung cấp ngữ cảnh, không phải điểm chất lượng hay thứ hạng.`;
  if (finding.id === "content-focus-topic" && values?.missingAreas) {
    const areas = values.missingAreas as string[];
    const labels: Record<string,string> = { title: "tiêu đề", description: "mô tả", headings: "các tiêu đề mục", "main content": "nội dung chính" };
    title = areas.length ? "Kiểm tra mức độ bao quát chủ đề trọng tâm" : "Cụm từ trọng tâm xuất hiện ở các phần chính";
    explanation = areas.length ? `Cụm từ trọng tâm chính xác chưa xuất hiện trong: ${areas.map(area => labels[area] || area).join(", ")}. Từ đồng nghĩa và biến thể vẫn có thể diễn đạt tốt chủ đề.` : "Cụm từ chính xác xuất hiện trong tiêu đề, mô tả, tiêu đề mục và nội dung chính. Điều này chưa khẳng định tính phù hợp hoặc ý định tìm kiếm.";
  }
  return { ...finding, title, explanation, recommendation, ...(evidence !== undefined ? { evidence } : {}) };
}
