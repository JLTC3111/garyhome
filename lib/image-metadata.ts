import { imageFilenameKey } from "./image-filenames.ts";
import type { Language } from "./types";

export const PHOTO_TEXT_LIMIT = 240;
type PhotoText = `description_${Language}` | `alt_${Language}`;
export type PhotoMetadata = Partial<Record<PhotoText | "public_filename", string>>;
export type ImageMetadata = Record<string, PhotoMetadata>;
const textFields = ["description_en", "description_vi", "alt_en", "alt_vi"] as const;
const imageExtension = /\.(?:avif|webp|jpe?g|png|gif|heic|heif)$/iu;

export function publicPhotoFilename(value: unknown) {
  if (typeof value !== "string") return "";
  const filename = value.trim();
  if (!filename || [...filename].length > 120 || !imageExtension.test(filename) ||
      !/^[\p{L}\p{M}\p{N} _.,‐–—’'()+&#*-]+$/u.test(filename)) return "";
  const stem = filename.replace(imageExtension, "");
  if (!/\p{L}/u.test(stem) || /[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}|[a-f\d]{20,}/iu.test(stem)) return "";
  const words = stem.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").replace(/[_-]/g, " ");
  if (/\d{7,}|(?:\d[ .()+-]*){9,}|\b(?:passport|identity|id card|tenant|landlord|invoice|contract|cccd|cmnd|ho chieu|can cuoc|hop dong|hoa don)\b/iu.test(words)) return "";
  return filename;
}

export function photoMetadata(src: string, records?: ImageMetadata): PhotoMetadata {
  const key = imageFilenameKey(src);
  return records && Object.hasOwn(records, key) ? records[key] || {} : {};
}

function photoText(value: unknown) {
  return typeof value === "string" ? [...value.trim()].slice(0, PHOTO_TEXT_LIMIT).join("") : "";
}

export function pruneImageMetadata(images: string[], records?: ImageMetadata): ImageMetadata {
  return Object.fromEntries(images.flatMap<[string, PhotoMetadata]>(src => {
    const key = imageFilenameKey(src);
    if (!key || [...key].length > 4096) return [];
    const entry = photoMetadata(src, records), cleaned: PhotoMetadata = {};
    for (const field of textFields) {
      const value = photoText(entry[field]);
      if (value) cleaned[field] = value;
    }
    const filename = publicPhotoFilename(entry.public_filename);
    if (filename) cleaned.public_filename = filename;
    return Object.keys(cleaned).length ? [[key, cleaned]] : [];
  }));
}

export function galleryPhotoMetadata(src: string, records: ImageMetadata | undefined, language: Language, fallback: string) {
  const entry = photoMetadata(src, records);
  const other = language === "vi" ? "en" : "vi";
  const description = photoText(entry[`description_${language}`]) || photoText(entry[`description_${other}`]);
  const alt = photoText(entry[`alt_${language}`]) || photoText(entry[`alt_${other}`]);
  const filename = publicPhotoFilename(entry.public_filename);
  const stem = filename.replace(imageExtension, "");
  const readable = /^(?:img|dsc|dscf|pxl|image|photo|pic)?[ _-]*\d+$/iu.test(stem) ? filename
    : stem.replace(/[-_]+/g, " ").trim();
  return { caption: description || alt || readable || fallback, filename, alt };
}
