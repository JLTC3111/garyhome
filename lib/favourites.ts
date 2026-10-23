// Consolidate the retired guest cart into the browser's existing favourites.
// Signed-in imports still require the customer's explicit import action.
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
