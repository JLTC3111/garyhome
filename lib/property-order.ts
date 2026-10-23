import type { Property,PropertyOrders } from "./types";
export function newestFirst(a:Property,b:Property){
 const posted=(p:Property)=>Date.parse(p.published_at||p.created_at)||0;
 return posted(b)-posted(a)||a.id.localeCompare(b.id);
}
export function applyPropertyOrder(properties:Property[],ids:readonly string[]=[]){
 if(!ids.length)return [...properties].sort(newestFirst);
 const position=new Map(ids.map((id,i)=>[id,i]));
 return [...properties].sort((a,b)=>(position.get(a.id)??Infinity)-(position.get(b.id)??Infinity)||newestFirst(a,b));
}
export function propertyOrders(rows:{scope:string;property_ids:string[]}[]|null):PropertyOrders{
 return Object.fromEntries((rows||[]).filter(row=>row.scope==="home"||row.scope==="listings").map(row=>[row.scope,row.property_ids]));
}
