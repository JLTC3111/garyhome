import type { SupabaseClient } from "@supabase/supabase-js";
import { imageOriginalFilename } from "./image-filenames";
import { imageOptimizationErrorText, optimizeImage, propertyPhoto } from "./image-optimization.mjs";
import { uploadListingFile, type ListingUploadOptions } from "./listing-file-upload";
import { PROPERTY_IMAGE_MAX_BYTES, PROPERTY_IMAGE_BUCKET, propertyImageFormat, propertyPhotoStorageKey } from "./property-photo-files";
import type { PlannedListingPhoto } from "./listing-gallery-checkpoint";

export { PROPERTY_IMAGE_MAX_BYTES, PROPERTY_IMAGE_BUCKET };
const uploadPaths = new WeakMap<File, { scope: string; path: string }>();
const encodedPhotos = new WeakMap<File, Awaited<ReturnType<typeof optimizeImage>>>();

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

// Browser MIME labels can be empty or change when an image is renamed. Read
// the format from the bytes, and give Storage a Blob with that actual MIME.
export async function preparePropertyImage(file: File) {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error(emptyImage);
  if (file.size > PROPERTY_IMAGE_MAX_BYTES) throw new Error(imageTooLarge);
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.slice(0, 4096).arrayBuffer()); }
  catch { throw new Error(unreadableImage); }
  const format = propertyImageFormat(bytes, file.size);
  if (!format) throw new Error(unsupportedImage);
  return { ...format, body: file.slice(0, file.size, format.contentType) };
}

export function imageUploadError(error: unknown, language = "en"): string {
  const optimization = imageOptimizationErrorText(error, language);
  if (optimization) return optimization;
  const issue = error && typeof error === "object" ? error as { name?: unknown; message?: unknown; code?: unknown; status?: unknown; statusCode?: unknown } : {};
  const message = typeof issue.message === "string" ? issue.message : typeof error === "string" ? error : "";
  if (knownMessages.has(message)) return message;
  const code = String(issue.code || "").toLowerCase(), status = Number(issue.status || issue.statusCode);
  if (issue.name === "ListingUploadLeaseError") {
    if (code === "pgrst202" || code === "42883") return language === "vi"
      ? "Chưa có chức năng bảo vệ ảnh tải lên. Hãy báo người vận hành kiểm tra bản cập nhật kho Home."
      : "Upload reservations are unavailable. Ask the operator to check the Home media migration.";
    if (code === "pt409") return language === "vi"
      ? "Đường dẫn ảnh đang bận hoặc đã có tệp. Kiểm tra bộ ảnh khôi phục trước khi tải lại."
      : "This upload path is already in use or reserved. Check the gallery recovery before uploading again.";
    if (status !== 403) return language === "vi"
      ? "Chưa thể giữ chỗ tải ảnh. Kiểm tra kết nối rồi thử lại."
      : "The photo upload could not be reserved. Reconnect and try again.";
  }
  if (status === 413 || /entitytoolarge|payloadtoolarge|invalidfilesize/.test(code) || /file too large|payload too large|entity too large|size.*exceed|exceed.*size|size limit/i.test(message)) return imageTooLarge;
  if (status === 415 || /invalidmimetype/.test(code) || /mime.*(?:unsupported|not supported)|unsupported.*(?:mime|media|image)/i.test(message)) return unsupportedImage;
  if (status === 401 || /invalidjwt|jwtexpired|invalidtoken|expiredtoken/.test(code) || /jwt.*(?:invalid|expired)|token.*expired/i.test(message)) return expiredSignIn;
  if (status === 403 || code === "42501" || /accessdenied/.test(code) || /row.level security|permission denied|not authorized|unauthorized/i.test(message)) return uploadPermissions;
  if (issue.name === "RequestTimeoutError" || /timed?\s*out|timeout/i.test(message)) return uploadTimeout;
  if (issue.name === "AbortError") return interruptedUpload;
  if (/network|failed to fetch|fetch failed|load failed|offline|connection.*lost/i.test(message)) return failedConnection;
  return unknownUpload;
}

export type PropertyImageUploadOptions = ListingUploadOptions & { listingId?: string; expectedUserId?: string; onPlanned?: (photo: PlannedListingPhoto) => void };

export async function uploadPropertyImage(db: SupabaseClient, file: File, signal?: AbortSignal, options: PropertyImageUploadOptions = {}): Promise<string> {
  signal?.throwIfAborted();
  const originalFilename = imageOriginalFilename(file.name);
  let prepared = encodedPhotos.get(file);
  if (!prepared) {
    await preparePropertyImage(file);
    prepared = await optimizeImage(file, propertyPhoto, {signal, inputMax:PROPERTY_IMAGE_MAX_BYTES});
    // A resumable transfer must continue with the same encoded bytes.
    encodedPhotos.set(file, prepared);
  }
  signal?.throwIfAborted();
  const {listingId,onPlanned,...progress}=options;
  const scope=listingId ? `properties/listings/${listingId}` : "properties";
  let attempt = uploadPaths.get(file);
  if (!attempt || attempt.scope!==scope) {
    attempt={scope,path:propertyPhotoStorageKey(originalFilename,prepared.extension,crypto.randomUUID(),listingId)};
    uploadPaths.set(file, attempt);
  }
  onPlanned?.({path:attempt.path,url:db.storage.from(PROPERTY_IMAGE_BUCKET).getPublicUrl(attempt.path).data.publicUrl,
    filename:originalFilename,bytes:prepared.body.size,mime:prepared.contentType});
  try {
    const url = await uploadListingFile({ client: db, file: prepared.body, resumeKey: file, bucket: PROPERTY_IMAGE_BUCKET,
      path: attempt.path, contentType: prepared.contentType, originalFilename, ...progress, signal });
    uploadPaths.delete(file);
    encodedPhotos.delete(file);
    return url;
  } catch (error) {
    if (error instanceof Error && error.name === "ListingUploadLeaseError") throw error;
    throw new Error(imageUploadError(error));
  }
}
