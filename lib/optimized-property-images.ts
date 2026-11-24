// Only public listing objects on this deployment's Storage origin may use
// the server-side image optimizer. Existing external URLs stay native.
const host = "duyiihsmaqfgwezmsnjs.supabase.co";
const directory = "/storage/v1/object/public/property-media/";

export const propertyImageRemotePattern = {
  protocol: "https", hostname: host, port: "", pathname: directory + "**", search: "",
} as const;

export function isOptimizablePropertyImage(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && url.host === host && !url.username && !url.password && !url.search
      && url.pathname.startsWith(directory) && /\.(avif|jpe?g|png|webp)$/i.test(url.pathname);
  } catch { return false; }
}
