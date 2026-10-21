import properties from "@/data/properties.json";
import content from "@/data/site-content.json";
import type { Content } from "./types";
export const seed: Content = { ...content, properties: properties as Content["properties"] };
