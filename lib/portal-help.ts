import type { StaffRole } from "./staff";
export const HELP_BUCKET = "portal-guides";
export const HELP_MAX_FILE = 50 * 1024 * 1024;
export const HELP_MAX_FILES = 12;
export const HELP_MANUAL_FILENAME = "home_website_manual.mp4";
export const HELP_FILE_TYPES: Record<string, { extension: string; kind: "video" | "animation" | "pdf" | "image" }> = {
  "video/mp4": { extension: "mp4", kind: "video" }, "video/webm": { extension: "webm", kind: "video" },
  "video/quicktime": { extension: "mov", kind: "video" }, "application/pdf": { extension: "pdf", kind: "pdf" },
  "image/gif": { extension: "gif", kind: "animation" }, "image/webp": { extension: "webp", kind: "animation" },
  "image/png": { extension: "png", kind: "image" }, "image/apng": { extension: "png", kind: "animation" },
  "image/jpeg": { extension: "jpg", kind: "image" },
};
export type HelpFile = { id: string; guide_id: string; storage_path: string; original_name: string; mime_type: string; size_bytes: number; created_at: string };
export type HelpGuide = {
  id: string; title_en: string; title_vi: string; summary_en: string; summary_vi: string; body_en: string; body_vi: string;
  audience: "customer" | "staff" | "both"; minimum_role: StaffRole | null; published: boolean; sort_order: number;
  created_at: string; updated_at: string; files: HelpFile[];
};
export const HELP_FIELDS = "id,title_en,title_vi,summary_en,summary_vi,body_en,body_vi,audience,minimum_role,published,sort_order,created_at,updated_at,files:portal_guide_files(id,guide_id,storage_path,original_name,mime_type,size_bytes,created_at)";
// Featuring never broadens access: the owner must publish the manual for both portals.
export function portalManual(guides: HelpGuide[]) {
  for (const guide of guides) {
    if (!guide.published || guide.audience !== "both") continue;
    const file = guide.files.filter(file => file.original_name === HELP_MANUAL_FILENAME && HELP_FILE_TYPES[file.mime_type]?.kind === "video")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (file) return { guide, file };
  }
  return null;
}
export function helpFileType(file: Pick<File, "type" | "size">) {
  const type = HELP_FILE_TYPES[file.type];
  if (!type || file.size <= 0 || file.size > HELP_MAX_FILE) throw new Error("file_limits");
  return type;
}
export function helpUploadPath(userId: string, guideId: string, fileId: string, file: Pick<File, "type" | "size">) {
  return `${userId}/${guideId}/${fileId}.${helpFileType(file).extension}`;
}
export function helpFileSize(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
