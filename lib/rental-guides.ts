import { newsArticles } from "./news-articles.ts";
import { editorialSeed, editorialView } from "./editorial.ts";
export type RentalGuide={slug:string;title:readonly[string,string];summary:readonly[string,string];sections:{title:readonly[string,string];items:(readonly[string,string])[]}[]};
// Existing imports keep their shape; content is maintained in the CMS.
export const rentalGuides:RentalGuide[]=editorialSeed.filter(row=>row.kind==="tip").map(editorialView);
export const editorialArticles=[...newsArticles,...rentalGuides];
