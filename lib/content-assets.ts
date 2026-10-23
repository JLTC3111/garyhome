import aliases from "../data/asset-paths.json" with { type:"json" };
import type { Content } from "./types";
const paths:Record<string,string>=aliases;
export function assetPath(value:string){return paths[value]||value;}
// Normalize stored/older CMS URLs while the reorganized assets are deployed.
export function contentAssets(content:Content):Content{return {...content,
 properties:content.properties.map(p=>({...p,images:p.images.map(assetPath)})),
 neighbourhoods:content.neighbourhoods.map(n=>({...n,image:assetPath(n.image)})),
 settings:{...content.settings,hero_image:assetPath(content.settings.hero_image)},
 ...(content.authors?{authors:content.authors.map(a=>({...a,portrait_url:assetPath(a.portrait_url)}))}:{}),
 ...(content.activities?{activities:content.activities.map(a=>({...a,image_url:assetPath(a.image_url)}))}:{})};}
