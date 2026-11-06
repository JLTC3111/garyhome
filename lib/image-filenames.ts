export type ImageFilenames = Record<string, string>;
export type ImageFilenameDetails = { filename: string; source: "original" | "stored" | "unavailable" };

export const IMAGE_FILENAME_MAX_LENGTH = 512;
const MAX_KEY_LENGTH = 4096;

// Filenames are labels only. They never become object keys or local paths.
export function imageOriginalFilename(value?: string | null): string {
  if (!value) return "";
  const basename = value.split(/[\\/]/).at(-1)?.replace(/\p{Cc}/gu, "") || "";
  if ([...basename].length > IMAGE_FILENAME_MAX_LENGTH) throw new Error("Image filenames must be 512 characters or fewer.");
  return basename;
}

export function imageFilenameKey(src: string): string {
  if (!src.startsWith("data:")) return src;
  // Non-security hash: keep inline preview URLs out of persisted metadata keys.
  // Four independently seeded 32-bit streams provide a stable compact identity.
  const hash = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let i = 0; i < src.length; i++) {
    const code = src.charCodeAt(i);
    for (let part = 0; part < hash.length; part++) hash[part] = Math.imul(hash[part] ^ code, 0x01000193 + part * 2);
  }
  return "inline:" + hash.map(part => (part >>> 0).toString(16).padStart(8, "0")).join("");
}

export function imageFilenameDetails(src: string, filenames?: ImageFilenames): ImageFilenameDetails {
  const key = imageFilenameKey(src);
  if (filenames && Object.hasOwn(filenames, key) && typeof filenames[key] === "string") {
    try {
      const stored = imageOriginalFilename(filenames[key]);
      if (stored) return { filename: stored, source: "original" };
    } catch { /* Unsupported legacy metadata falls back to the actual URL name. */ }
  }
  if (src.startsWith("data:") || src.startsWith("blob:")) return { filename: "", source: "unavailable" };
  try {
    const path = new URL(src, "https://filename.invalid").pathname;
    const encoded = path.split("/").at(-1) || "";
    let name = encoded;
    try { name = decodeURIComponent(encoded); } catch { /* Keep malformed legacy escapes readable. */ }
    const filename = imageOriginalFilename(name);
    return { filename, source: filename ? "stored" : "unavailable" };
  } catch {
    return { filename: "", source: "unavailable" };
  }
}

export function imageFilename(src: string, filenames?: ImageFilenames): string {
  return imageFilenameDetails(src, filenames).filename;
}

export function addImageFilename(filenames: ImageFilenames | undefined, src: string, original?: string | null): ImageFilenames {
  const name = imageOriginalFilename(original), next = { ...filenames };
  if (!name) return next;
  const key = imageFilenameKey(src);
  if (!key || [...key].length > MAX_KEY_LENGTH) throw new Error("Image addresses must be 4096 characters or fewer.");
  Object.defineProperty(next, key, { value: name, enumerable: true, configurable: true, writable: true });
  if (Object.keys(next).length > 40) throw new Error("A listing can contain up to 40 photos.");
  return next;
}

export function pruneImageFilenames(images: string[], filenames?: ImageFilenames): ImageFilenames {
  const entries: [string, string][] = [];
  for (const src of images) {
    const key = imageFilenameKey(src);
    if (!filenames || !Object.hasOwn(filenames, key) || typeof filenames[key] !== "string" || !key || [...key].length > MAX_KEY_LENGTH) continue;
    try {
      const name = imageOriginalFilename(filenames[key]);
      if (name) entries.push([key, name]);
    } catch { /* Drop invalid legacy metadata without blocking unrelated edits. */ }
  }
  return Object.fromEntries(entries);
}
