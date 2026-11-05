export const LISTING_VIDEO_BUCKET = "listing-videos";
// Public storage origin used by this project and its matching database constraint.
export const LISTING_VIDEO_ORIGIN = "https://duyiihsmaqfgwezmsnjs.supabase.co";
export const LISTING_VIDEO_MAX_BYTES = 50_000_000;

export function propertyVideoFileError(file: Pick<File, "name" | "size" | "type">): string | null {
  if (!/\.mp4$/i.test(file.name) || file.type && file.type !== "video/mp4") return "Choose an MP4 video (.mp4).";
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return "Choose a video file that is not empty.";
  return file.size >= LISTING_VIDEO_MAX_BYTES ? "The video must be smaller than 50 MB." : null;
}

export async function validatePropertyVideoFile(file: File): Promise<string | null> {
  const error = propertyVideoFileError(file);
  if (error) return error;
  try {
    const bytes = new Uint8Array(await file.slice(0, 80).arrayBuffer());
    const ascii = (from: number) => String.fromCharCode(...bytes.slice(from, from + 4));
    if (bytes.length < 16 || ascii(4) !== "ftyp") return "This file is not a valid MP4 video. Choose an MP4 export.";
    const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (boxSize < 16 || boxSize > file.size) return "This file is not a valid MP4 video. Choose an MP4 export.";
    const isMp4Brand = (brand: string) => /^(?:isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash|cmfc|cmfs)$/.test(brand);
    if (isMp4Brand(ascii(8))) return null;
    for (let offset = 16; offset + 4 <= Math.min(boxSize, bytes.length); offset += 4) {
      if (isMp4Brand(ascii(offset))) return null;
    }
    return "This file is not a valid MP4 video. Choose an MP4 export.";
  } catch {
    return "Couldn’t read the video. Choose the file again.";
  }
}

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const uploadedVideoPath = new RegExp(`^/storage/v1/object/public/${LISTING_VIDEO_BUCKET}/${uuid}/${uuid}/${uuid}\\.mp4$`, "i");

export function propertyVideoUrlError(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 2048) return "Use one uploaded MP4 video for this listing.";
  try {
    const url = new URL(value);
    if (url.origin === LISTING_VIDEO_ORIGIN && value.startsWith(LISTING_VIDEO_ORIGIN + "/") && !url.username && !url.password && !url.search && !url.hash && uploadedVideoPath.test(url.pathname)) return null;
  } catch { /* Show the same actionable message for any unsupported video URL. */ }
  return "Use one uploaded MP4 video for this listing.";
}
