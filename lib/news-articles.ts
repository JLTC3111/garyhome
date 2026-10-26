import type { RentalGuide } from "./rental-guides";
import { editorialSeed, editorialView } from "./editorial.ts";
export type NewsArticle = RentalGuide & { published:string; category:readonly[string,string]; image:string; sources:{title:string;url:string}[] };
// Compatibility exports derive from the same seed as the live editorial CMS.
export const newsArticles = editorialSeed.filter(row=>row.kind==="news").map(editorialView) as NewsArticle[];
export function articleDate(date:string,language:"en"|"vi"){return new Date(date+"T00:00:00Z").toLocaleDateString(language==="vi"?"vi-VN":"en-GB",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"});}
