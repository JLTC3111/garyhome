import {PROPERTY_IMAGE_ORIGIN, propertyPhotoPath, propertyPhotoUrl} from "./property-photo-files";

const transformPrefix = PROPERTY_IMAGE_ORIGIN + "/storage/v1/render/image/public/property-media/";

// Resolve legacy transform URLs at display time. CMS references, filename
// metadata keys and the photo rename workflow still use the stored source.
export function publicPropertyImageSource(src: string) {
  if (!src.startsWith(transformPrefix)) return src;
  const key = propertyPhotoPath(src, PROPERTY_IMAGE_ORIGIN);
  return key ? propertyPhotoUrl(PROPERTY_IMAGE_ORIGIN, key) : src;
}
