import Image from "next/image";
import type { ImgHTMLAttributes } from "react";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height" | "alt"> & {
  src: string; alt: string; width: number; height: number;
};

// Resize our public raster assets for the actual viewport. External CMS URLs
// remain native images: do not allow arbitrary remote optimizer fetches.
export function ContentImage({src, width, height, alt, ...props}: Props) {
  const local = src.startsWith("/") && !src.startsWith("//") && !src.startsWith("/api/") && !/\.(svg|gif)(?:\?|$)/i.test(src);
  return local ? <Image {...props} src={src} alt={alt} width={width} height={height}/> : <img {...props} src={src} alt={alt} width={width} height={height}/>;
}
