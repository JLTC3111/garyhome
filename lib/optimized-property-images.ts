// Only public listing objects on this deployment's Storage origin may use
// the server-side image optimizer. Existing external URLs stay native.
import {propertyPhotoPath, propertyPhotoUrl} from "./property-photo-files";

const host = "duyiihsmaqfgwezmsnjs.supabase.co";
const directory = "/storage/v1/object/public/property-media/";
const origin = `https://${host}`;
const transformPrefix = origin + "/storage/v1/render/image/public/property-media/";

export const propertyImageRemotePattern = {
  protocol: "https", hostname: host, port: "", pathname: directory + "**", search: "",
} as const;

// Resolve legacy transform URLs at display time. CMS references, filename
// metadata keys and the photo rename workflow still use the stored source.
export function publicPropertyImageSource(src: string) {
  if (!src.startsWith(transformPrefix)) return src;
  const key = propertyPhotoPath(src, origin);
  return key ? propertyPhotoUrl(origin, key) : src;
}

export function isOptimizablePropertyImage(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && url.host === host && !url.username && !url.password && !url.search
      && url.pathname.startsWith(directory) && /\.(avif|jpe?g|png|webp)$/i.test(url.pathname);
  } catch { return false; }
}
