import type { CustomerEnquiry, CustomerProfile, CustomerRecord, Enquiry, Language } from "./types";

// Never use select('*') on enquiries: legacy notes have no client SELECT grant.
export const ENQUIRY_FIELDS = "id,property_id,name,email,phone,message,preferred_date,kind,consent,status,created_at,user_id,appointment_at,customer_update,cancelled_at";
export const CUSTOMER_STAGES = ["new", "contacted", "viewing", "tenant", "closed"] as const;
export function hanoiDay() { return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10); }
export type CustomerSummary = CustomerRecord & { profile: CustomerProfile | null; enquiries: Enquiry[] };

export function customerSummaries(profiles: CustomerProfile[], enquiries: Enquiry[], records: CustomerRecord[]): CustomerSummary[] {
  const customers = new Map<string, CustomerSummary>();
  const create = (key: string, name: string, email: string, phone: string, userId: string | null): CustomerSummary => ({
    customer_key: key, user_id: userId, name, email, phone, stage: "new", follow_up_on: null,
    notes: "", updated_at: "", profile: null, enquiries: [],
  });
  for (const profile of profiles) {
    const key = "user:" + profile.user_id;
    customers.set(key, { ...create(key, profile.full_name || profile.email, profile.email, profile.phone, profile.user_id), profile, updated_at: profile.updated_at });
  }
  for (const enquiry of enquiries) {
    const key = enquiry.user_id ? "user:" + enquiry.user_id : "guest:" + enquiry.email.trim().toLowerCase();
    const customer = customers.get(key) ?? create(key, enquiry.name, enquiry.email, enquiry.phone, enquiry.user_id ?? null);
    customer.enquiries.push(enquiry);
    if (!customer.updated_at || enquiry.created_at > customer.updated_at) customer.updated_at = enquiry.created_at;
    customers.set(key, customer);
  }
  for (const record of records) {
    const customer = customers.get(record.customer_key) ?? create(record.customer_key, record.name, record.email, record.phone, record.user_id);
    customers.set(record.customer_key, { ...customer, ...record });
  }
  return [...customers.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function enquiryLabel(enquiry: CustomerEnquiry, language: Language) {
  const labels = language === "vi"
    ? { cancelled: "Đã hủy", confirmed: "Đã xác nhận", requested: "Đang chờ xác nhận", new: "Đã nhận", contacted: "Đang trao đổi", scheduled: "Đang sắp xếp", closed: "Đã hoàn tất" }
    : { cancelled: "Cancelled", confirmed: "Confirmed", requested: "Awaiting confirmation", new: "Received", contacted: "In conversation", scheduled: "Being arranged", closed: "Closed" };
  if (enquiry.cancelled_at) return labels.cancelled;
  if (enquiry.kind === "viewing" && enquiry.status === "scheduled" && enquiry.appointment_at) return labels.confirmed;
  if (enquiry.kind === "viewing" && enquiry.status === "new") return labels.requested;
  return labels[enquiry.status];
}

export function appointmentLabel(date: string, language: Language) {
  return new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-GB", {
    timeZone: "Asia/Ho_Chi_Minh", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(date));
}

export function hanoiInput(date?: string | null) {
  if (!date) return "";
  return new Date(new Date(date).getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

export function customerError(error: unknown, language: Language) {
  const value = error as { code?: string; message?: string } | null;
  const message = value?.message ?? "";
  if (/timed out|timeout/i.test(message)) return language === "vi"
    ? "Yêu cầu hết thời gian chờ và có thể đã được lưu. Hãy làm mới dữ liệu để kiểm tra trước khi thử lại."
    : "The request timed out and may have been saved. Refresh to check the current data before trying again.";
  if (/account changed|sign in|session|reconnect|offline|connection/i.test(message)) return language === "vi"
    ? "Hãy kết nối lại và xác nhận tài khoản trước khi tiếp tục. Nội dung bạn đang nhập vẫn được giữ."
    : "Reconnect and verify your account before continuing. Your draft is still here.";
  if (value?.code === "PGRST205" || value?.code === "42703" || value?.code === "42P01") return language === "vi"
    ? "Cổng khách hàng chưa sẵn sàng. Vui lòng liên hệ đội ngũ để được hỗ trợ."
    : "The customer portal is not available yet. Please contact the team for help.";
  return language === "vi" ? "Không thể hoàn tất yêu cầu. Hãy làm mới dữ liệu và thử lại hoặc liên hệ đội ngũ." : "We couldn’t complete this request. Refresh and try again, or contact the team.";
}
