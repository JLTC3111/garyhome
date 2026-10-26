// Consolidate the retired guest cart into the browser's existing favourites.
// Signed-in sessions merge guest selections after their private list loads.
export function readBrowserFavourites(storage: Pick<Storage,"getItem"|"setItem"|"removeItem">): string[] {
  function ids(key:string):string[]{
    try{const value=JSON.parse(storage.getItem(key)||"[]");return Array.isArray(value)?value.filter((id):id is string=>typeof id==="string"&&id.length<=80):[];}catch{return [];}
  }
  const saved=ids("gary-saved"),legacy=ids("gary-rental-cart");
  const merged=[...new Set([...saved,...legacy])];
  if(legacy.length){
    try{storage.setItem("gary-saved",JSON.stringify(merged));storage.removeItem("gary-rental-cart");}catch{/* Keep the original cart if persistence is unavailable. */}
  }
  return merged;
}

const CLAIMS_KEY="gary-favourites-import-owners";
function importOwners(storage:Pick<Storage,"getItem">):Map<string,string>{
 try{const value=JSON.parse(storage.getItem(CLAIMS_KEY)||"{}");if(!value||Array.isArray(value)||typeof value!=="object")return new Map();return new Map(Object.entries(value).filter(([id,owner])=>id.length<=80&&typeof owner==="string"&&owner.length<=80) as [string,string][]);}catch{return new Map();}
}
// A pending transfer belongs to the account that started it. An account switch
// or uncertain network outcome must not transfer that shortlist to another user.
export function claimBrowserFavourites(storage:Pick<Storage,"getItem"|"setItem">,userId:string,ids:string[]):string[]{
 const owners=importOwners(storage),selected=ids.filter(id=>!owners.has(id)||owners.get(id)===userId);
 for(const id of selected)owners.set(id,userId);
 if(selected.length)storage.setItem(CLAIMS_KEY,JSON.stringify(Object.fromEntries(owners)));
 return selected;
}
export function acknowledgeBrowserFavourites(storage:Pick<Storage,"getItem"|"setItem"|"removeItem">,userId:string,ids:string[]){
 const owners=importOwners(storage),completed=new Set(ids.filter(id=>owners.get(id)===userId));
 // Clear confirmed guest IDs before releasing their ownership claims. If
 // persistence fails, the remaining claim keeps the retry with this account.
 for(const key of ["gary-saved","gary-rental-cart"]){let current:string[]=[];try{const value=JSON.parse(storage.getItem(key)||"[]");if(Array.isArray(value))current=value.filter((id):id is string=>typeof id==="string");}catch{/* Repair malformed browser data only after a confirmed transfer. */}
  const remaining=current.filter(id=>!completed.has(id));if(remaining.length)storage.setItem(key,JSON.stringify(remaining));else storage.removeItem(key);
 }
 for(const id of completed)owners.delete(id);if(owners.size)storage.setItem(CLAIMS_KEY,JSON.stringify(Object.fromEntries(owners)));else storage.removeItem(CLAIMS_KEY);
}
export function releaseBrowserFavouriteClaim(storage:Pick<Storage,"getItem"|"setItem"|"removeItem">,id:string){const owners=importOwners(storage);owners.delete(id);if(owners.size)storage.setItem(CLAIMS_KEY,JSON.stringify(Object.fromEntries(owners)));else storage.removeItem(CLAIMS_KEY);}
