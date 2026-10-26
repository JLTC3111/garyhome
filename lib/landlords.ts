import { z } from "zod";
export const LANDLORD_BUCKET="landlord-files";
export const LANDLORD_MAX_FILE=5*1024*1024;
export const LANDLORD_MAX_TOTAL=25*1024*1024;
export const LANDLORD_MAX_FILES=6;
export const landlordMimeExtensions:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/avif":"avif","application/pdf":"pdf"};
export const landlordFileInput=z.object({name:z.string().trim().min(1).max(160),type:z.enum(["image/jpeg","image/png","image/webp","image/avif","application/pdf"]),size:z.number().int().positive().max(LANDLORD_MAX_FILE)});
export const landlordManifest=z.array(landlordFileInput).max(LANDLORD_MAX_FILES).refine(files=>files.reduce((sum,file)=>sum+file.size,0)<=LANDLORD_MAX_TOTAL);
export const landlordDetails=z.object({
 owner_name:z.string().trim().min(2).max(120),email:z.string().trim().toLowerCase().email().max(254),phone:z.string().trim().max(40).default(""),
 address:z.string().trim().min(5).max(300),district_slug:z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(100).nullable(),
 property_type:z.enum(["Apartment","Villa/Duplex","Office & Restaurant","Vinhomes"]),bedrooms:z.number().int().min(0).max(50),bathrooms:z.number().int().min(0).max(50).nullable(),
 area_sqm:z.number().positive().max(99999999).nullable(),expected_rent:z.number().min(0).max(999999999999).nullable(),currency:z.literal("USD"),
 message:z.string().trim().min(10).max(4000),consent:z.literal(true),website:z.literal("").optional()
});
export const landlordPrepare=z.object({action:z.literal("prepare"),files:landlordManifest,website:z.literal("").optional()});
export const landlordFinalise=z.object({action:z.literal("finalize"),permit:z.string().min(10).max(16000),details:landlordDetails});
export type LandlordFile={id:string;submission_id:string;storage_path:string;original_name:string;mime_type:string;size_bytes:number};
export type LandlordSubmission={id:string;owner_name:string;email:string;phone:string;address:string;district_slug:string|null;property_type:string;bedrooms:number;bathrooms:number|null;area_sqm:number|null;expected_rent:number|null;currency:string;message:string;status:string;assigned_to:string|null;staff_notes:string;listing_id:string|null;enquiry_id:string|null;created_at:string;updated_at:string};
export const landlordStatuses:Record<string,readonly[string,string]>={new:["New","Mới"],reviewing:["Reviewing","Đang xem xét"],needs_details:["Needs details","Cần thông tin"],ready:["Ready for a draft","Sẵn sàng tạo bản nháp"],converted:["Draft created","Đã tạo bản nháp"],declined:["Declined","Không tiếp nhận"],archived:["Archived","Đã lưu trữ"]};
export type UploadFile={id:string;path:string;name:string;type:string;size:number};
export type UploadPermit={v:1;id:string;expires:number;userId:string|null;files:UploadFile[]};
export type PreparedUpload={permit:string;expires:number;url:string;key:string;files:(UploadFile&{token:string})[]};
export const landlordErrors:Record<string,readonly[string,string]>={
 invalid:["Check the property details and file limits, then try again.","Kiểm tra thông tin bất động sản và giới hạn tệp, rồi thử lại."],
 session:["Your session changed. Sign in again or reload before submitting.","Phiên đăng nhập đã thay đổi. Đăng nhập lại hoặc tải lại trước khi gửi."],
 expired:["The upload session expired. Submit again to start a new upload.","Phiên tải tệp đã hết hạn. Gửi lại để bắt đầu phiên tải mới."],
 files:["Some files could not be verified. Retry the submission; your details are still here.","Chưa xác minh được một số tệp. Thử gửi lại; thông tin của bạn vẫn được giữ."],
 rate:["Too many upload sessions. Please try tomorrow or contact Gary Home.","Đã vượt giới hạn phiên tải tệp. Vui lòng thử vào ngày mai hoặc liên hệ Gary Home."],
 unavailable:["Property introductions are temporarily unavailable. Please contact Gary Home or try again later.","Chức năng giới thiệu nhà tạm thời chưa khả dụng. Vui lòng liên hệ Gary Home hoặc thử lại sau."],
 connection:["The connection was interrupted. Retry to check and complete this submission.","Kết nối bị gián đoạn. Thử lại để kiểm tra và hoàn tất lần gửi này."],
 upload:["An upload was interrupted. Retry to continue with the same files.","Tải tệp bị gián đoạn. Thử lại để tiếp tục với các tệp hiện tại."]
};
export function safeLandlordFilename(name:string){return name.replace(/[\x00-\x1f\x7f/\\]/g,"_").trim().slice(0,160)||"attachment";}
