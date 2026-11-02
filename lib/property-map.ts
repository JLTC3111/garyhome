import type { Neighbourhood, Property } from "./types";

export function propertyMapLocation(
  property: Pick<Property, "address" | "district_slug" | "map_address">,
  district?: Pick<Neighbourhood, "name">,
) {
  const exactAddress = property.map_address?.trim();
  const area = property.address.trim() || district?.name || property.district_slug.replaceAll("-", " ");
  const query = exactAddress || [area, "Hanoi", "Vietnam"].filter(Boolean).join(", ");
  const encoded = encodeURIComponent(query);
  return {
    exact: Boolean(exactAddress),
    label: exactAddress || area || "Hanoi, Vietnam",
    query,
    embedUrl: `https://www.google.com/maps?q=${encoded}&z=${exactAddress ? 17 : 14}&output=embed`,
    externalUrl: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
  };
}
