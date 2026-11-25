import Image from "next/image";
import type { ImgHTMLAttributes } from "react";
import { publicPropertyImageSource } from "@/lib/optimized-property-images";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height" | "alt"> & {
  src: string; alt: string; width: number; height: number;
};

// Render CMS photos from their stored URLs so gallery delivery does not depend
// on the host's image optimizer. Bundled raster assets still use Next Image.
export function ContentImage({src, width, height, alt, decoding = "async", ...props}: Props) {
  const attributes = {...props, src:publicPropertyImageSource(src), width, height, decoding};
  const local = src.startsWith("/") && !src.startsWith("//") && !src.startsWith("/api/") && !/\.(svg|gif)(?:\?|$)/i.test(src);
  if (local) return <Image {...attributes} alt={alt}/>;
  // eslint-disable-next-line @next/next/no-img-element -- Storage delivery works independently of the optimizer quota.
  return <img {...attributes} alt={alt}/>;
}
