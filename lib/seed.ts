import properties from "@/data/properties.json";
import activities from "@/data/activities.json";
import authors from "@/data/authors.json";
import content from "@/data/site-content.json";
import type { Content } from "./types";
import { editorialSeed } from "./editorial";
export const seed: Content = { ...content, editorial:editorialSeed, properties: properties as Content["properties"], activities:activities as Content["activities"],authors:authors as Content["authors"] };
