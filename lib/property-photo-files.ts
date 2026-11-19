export const PROPERTY_IMAGE_BUCKET = "property-media";
export const PROPERTY_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const publicPhotoRoot = "/storage/v1/object/public/property-media/";
const renderedPhotoRoot = "/storage/v1/render/image/public/property-media/";
const imageSuffix = /\.(jpe?g|png|webp|avif)$/i;
type Extension = "jpg" | "png" | "webp" | "avif";

export function propertyPhotoExtension(filename: string): Extension | null {
  const suffix = filename.trim().match(imageSuffix)?.[1].toLowerCase();
  return suffix ? (suffix === "jpeg" ? "jpg" : suffix as Extension) : null;
}

export function propertyPhotoFilename(value: string, extension: Extension, requireMatchingExtension = false): string {
  let base = value.normalize("NFKC").trim();
  if (base.length > 512 || /[\\/%?#\p{Cc}\p{Cf}]/u.test(base) || base.includes("..")) return "";
  if (requireMatchingExtension && !propertyPhotoExtension(base) && /\.[a-z][a-z0-9]{1,7}$/i.test(base)) return "";
  let suppliedExtension = false;
  let copyNumber = "";
  for (;;) {
    const supplied = propertyPhotoExtension(base);
    if (supplied) {
      if (!suppliedExtension && requireMatchingExtension && supplied !== extension) return "";
      suppliedExtension = true;
      base = base.replace(imageSuffix, "").trimEnd();
      continue;
    }
    const suffix = base.match(/\s*\((\d{1,4})\)$/);
    if (!suffix) break;
    copyNumber ||= String(Number(suffix[1])).padStart(2, "0");
    base = base.slice(0, suffix.index).trimEnd();
  }
  base = base.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/đ/g, "d");
  base = base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 104).replace(/-+$/, "");
  if (!base) return "";
  if (copyNumber && !base.endsWith("-" + copyNumber)) base += "-" + copyNumber;
  return `${base}.${extension}`;
}

export function propertyPhotoPath(source: string, origin?: string): string | null {
  try {
    const url = new URL(source);
    if (url.username || url.password || !/^https?:$/.test(url.protocol) || origin && url.origin !== origin) return null;
    const prefix = [publicPhotoRoot, renderedPhotoRoot].find(candidate => url.pathname.startsWith(candidate));
    if (!prefix) return null;
    const parts = url.pathname.slice(prefix.length).split("/").map(decodeURIComponent);
    if (parts.some(part => !part || part === "." || part === ".." || /[\\/\p{Cc}]/u.test(part))) return null;
    const path = parts.join("/");
    return path.length <= 1024 ? path : null;
  } catch { return null; }
}

export function propertyPhotoUrl(origin: string, key: string) {
  return origin + publicPhotoRoot + key.split("/").map(encodeURIComponent).join("/");
}

export function replacePropertyPhotoUrl(source:string, origin:string, oldKey:string, newUrl:string) {
  if (propertyPhotoPath(source,origin)!==oldKey) return source;
  const canonical = source.startsWith(origin+renderedPhotoRoot)
    ? newUrl.replace(publicPhotoRoot,renderedPhotoRoot) : newUrl;
  return canonical+(source.match(/[?#][\s\S]*$/)?.[0]||"");
}

export function propertyImageFormat(bytes: Uint8Array, size: number): {contentType: string; extension: Extension} | null {
  const ascii = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { contentType: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((n, i) => bytes[i] === n)) return { contentType: "image/png", extension: "png" };
  if (bytes.length >= 16 && ascii(0) === "RIFF" && ascii(8) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(ascii(12))) return { contentType: "image/webp", extension: "webp" };
  if (bytes.length >= 16 && ascii(4) === "ftyp") {
    const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (boxSize < 16 || boxSize > size) return null;
    const avif = (offset: number) => ["avif", "avis"].includes(ascii(offset));
    if (avif(8)) return {contentType:"image/avif",extension:"avif"};
    for (let offset = 16; offset + 4 <= Math.min(boxSize, bytes.length); offset += 4)
      if (avif(offset)) return {contentType:"image/avif",extension:"avif"};
  }
  return null;
}
