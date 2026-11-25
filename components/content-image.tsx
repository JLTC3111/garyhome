import Image from "next/image";
import type { ImgHTMLAttributes } from "react";
import { isOptimizablePropertyImage, publicPropertyImageSource } from "@/lib/optimized-property-images";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height" | "alt"> & {
  src: string; alt: string; width: number; height: number;
};

// Resize our public raster assets for the actual viewport. External CMS URLs
// remain native images: do not allow arbitrary remote optimizer fetches.
export function ContentImage({src, width, height, alt, decoding = "async", ...props}: Props) {
  const source = publicPropertyImageSource(src);
  const local = src.startsWith("/") && !src.startsWith("//") && !src.startsWith("/api/") && !/\.(svg|gif)(?:\?|$)/i.test(src);
  return local || isOptimizablePropertyImage(source) ? <Image {...props} src={source} alt={alt} width={width} height={height} decoding={decoding}/> : <img {...props} src={source} alt={alt} width={width} height={height} decoding={decoding}/>;
}
