import type { SupabaseClient } from "@supabase/supabase-js";
import { imageOriginalFilename } from "./image-filenames";
import { uploadListingFile, type ListingUploadOptions } from "./listing-file-upload";

export const PROPERTY_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const PROPERTY_IMAGE_BUCKET = "property-media";
const uploadPaths = new WeakMap<File, string>();

const unsupportedImage = "This file is not a supported image. Choose a JPG, PNG, WebP, or AVIF file.";
const imageTooLarge = "Images must be 8 MB or smaller.";
const unreadableImage = "Couldn’t read the image. Choose the file again.";
const emptyImage = "Choose an image file that is not empty.";
const expiredSignIn = "Your sign-in expired. Reconnect and try uploading the image again.";
const uploadPermissions = "Your account does not have permission to upload images. Ask a team owner to check your staff access.";
const uploadTimeout = "The image upload timed out. Check your connection and try again.";
const interruptedUpload = "The image upload was interrupted. Reconnect and try again.";
const failedConnection = "The image could not upload because the connection failed. Reconnect and try again.";
const unknownUpload = "Couldn’t upload this image. Try again.";
const knownMessages = new Set(["No upload progress for 120 seconds. Check your connection and retry. Your uploaded photos are still here.", "Your sign-in expired. Reconnect and try uploading again.",unsupportedImage, imageTooLarge, unreadableImage, emptyImage, expiredSignIn, uploadPermissions, uploadTimeout, interruptedUpload, failedConnection, unknownUpload, "Connect Supabase before uploading.", "Image filenames must be 512 characters or fewer.", "CMS preview uploads must be under 2 MB for browser storage.", "Couldn’t read image.", "Reconnect and verify your editor access before saving. Your edits are still here.", "Your account changed. Sign in again before continuing.", "Your account changed during this request. Check the current data before continuing."]);

type ImageFormat = { contentType: string; extension: string };

function imageFormat(bytes: Uint8Array, size: number): ImageFormat | null {
  const ascii = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { contentType: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return { contentType: "image/png", extension: "png" };
  if (bytes.length >= 16 && ascii(0) === "RIFF" && ascii(8) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(ascii(12))) return { contentType: "image/webp", extension: "webp" };
  if (bytes.length >= 16 && ascii(4) === "ftyp") {
    const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (boxSize < 16 || boxSize > size) return null;
    const avifBrand = (offset: number) => ["avif", "avis"].includes(ascii(offset));
    if (avifBrand(8)) return { contentType: "image/avif", extension: "avif" };
    for (let offset = 16; offset + 4 <= Math.min(boxSize, bytes.length); offset += 4) {
      if (avifBrand(offset)) return { contentType: "image/avif", extension: "avif" };
    }
  }
  return null;
}

// Browser MIME labels can be empty or change when an image is renamed. Read
// the format from the bytes, and give Storage a Blob with that actual MIME.
export async function preparePropertyImage(file: File): Promise<{ body: Blob; contentType: string; extension: string }> {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error(emptyImage);
  if (file.size > PROPERTY_IMAGE_MAX_BYTES) throw new Error(imageTooLarge);
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.slice(0, 4096).arrayBuffer()); }
  catch { throw new Error(unreadableImage); }
  const format = imageFormat(bytes, file.size);
  if (!format) throw new Error(unsupportedImage);
  return { ...format, body: file.slice(0, file.size, format.contentType) };
}

export function imageUploadError(error: unknown): string {
  const issue = error && typeof error === "object" ? error as { name?: unknown; message?: unknown; code?: unknown; status?: unknown; statusCode?: unknown } : {};
  const message = typeof issue.message === "string" ? issue.message : typeof error === "string" ? error : "";
  if (knownMessages.has(message)) return message;
  const code = String(issue.code || "").toLowerCase(), status = Number(issue.status || issue.statusCode);
  if (status === 413 || /entitytoolarge|payloadtoolarge|invalidfilesize/.test(code) || /file too large|payload too large|entity too large|size.*exceed|exceed.*size|size limit/i.test(message)) return imageTooLarge;
  if (status === 415 || /invalidmimetype/.test(code) || /mime.*(?:unsupported|not supported)|unsupported.*(?:mime|media|image)/i.test(message)) return unsupportedImage;
  if (status === 401 || /invalidjwt|jwtexpired|invalidtoken|expiredtoken/.test(code) || /jwt.*(?:invalid|expired)|token.*expired/i.test(message)) return expiredSignIn;
  if (status === 403 || code === "42501" || /accessdenied/.test(code) || /row.level security|permission denied|not authorized|unauthorized/i.test(message)) return uploadPermissions;
  if (issue.name === "RequestTimeoutError" || /timed?\s*out|timeout/i.test(message)) return uploadTimeout;
  if (issue.name === "AbortError") return interruptedUpload;
  if (/network|failed to fetch|fetch failed|load failed|offline|connection.*lost/i.test(message)) return failedConnection;
  return unknownUpload;
}

export async function uploadPropertyImage(db: SupabaseClient, file: File, signal?: AbortSignal, options: ListingUploadOptions = {}): Promise<string> {
  signal?.throwIfAborted();
  const prepared = await preparePropertyImage(file);
  signal?.throwIfAborted();
  const originalFilename = imageOriginalFilename(file.name);
  let path = uploadPaths.get(file);
  if (!path) { path = `properties/${crypto.randomUUID()}.${prepared.extension}`; uploadPaths.set(file, path); }
  try {
    const url = await uploadListingFile({ client: db, file: prepared.body, resumeKey: file, bucket: PROPERTY_IMAGE_BUCKET,
      path, contentType: prepared.contentType, originalFilename, ...options, signal });
    uploadPaths.delete(file);
    return url;
  } catch (error) { throw new Error(imageUploadError(error)); }
}
