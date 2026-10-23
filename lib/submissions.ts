import { z } from "zod";

const contact = {
 name:z.string().trim().min(2).max(120), email:z.string().trim().email().max(254),
 consent:z.literal(true), website:z.string().max(0).optional(),
};
export const feedbackInput=z.object({
 ...contact, rating:z.number().int().min(1).max(5), message:z.string().trim().min(10).max(4000),
 property_id:z.string().uuid().nullable().default(null), publish_consent:z.boolean().default(false),
});
export const assistanceInput=z.object({
 ...contact, property_id:z.string().uuid(), phone:z.string().trim().max(40).default(""),
 helper_name:z.string().trim().min(2).max(160),
 channel:z.enum(["in_person","phone","zalo","whatsapp","email","website","referral","other"]),
 helped_where:z.string().trim().min(2).max(300),
 helped_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 helped_time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
 notes:z.string().trim().max(2000).default(""),
});
export function hanoiToday(){return new Date(Date.now()+7*60*60*1000).toISOString().slice(0,10);}
export function validHelpDate(value:string){return value>="2000-01-01"&&value<=hanoiToday()&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
export type PublicFeedback={id:string;name:string;rating:number;message:string;property_id:string|null;staff_reply:string;published_at:string};
export type FeedbackSubmission={id:string;name:string;email:string;rating:number;message:string;property_id:string|null;publish_consent:boolean;status:"pending"|"approved"|"declined";created_at:string};
export type AssistanceReport={id:string;property_id:string;name:string;email:string;phone:string;helper_name:string;channel:string;helped_where:string;helped_on:string;helped_time:string|null;notes:string;status:"submitted"|"verified"|"needs_details"|"declined";created_at:string};
export type AssistanceReview={report_id:string;credited_staff_id:string|null;confirmed_helper:string;internal_notes:string;reviewed_by:string|null;reviewed_at:string};
export const CHANNELS:Record<string,readonly[string,string]>={in_person:["In person","Trực tiếp"],phone:["Phone","Điện thoại"],zalo:["Zalo","Zalo"],whatsapp:["WhatsApp","WhatsApp"],email:["Email","Email"],website:["Website","Website"],referral:["Referral","Giới thiệu"],other:["Other","Khác"]};
export const SUBMISSION_STATUS:Record<string,readonly[string,string]>={pending:["Awaiting moderation","Chờ duyệt"],approved:["Published","Đã đăng"],declined:["Not approved","Không được duyệt"],submitted:["Awaiting verification","Chờ xác minh"],verified:["Verified","Đã xác minh"],needs_details:["More details needed","Cần thêm thông tin"]};
