import type { Language } from "./types";
export const LANGUAGE_COOKIE="gary-language";
export function languageValue(value:unknown):Language { return value==="vi"?"vi":"en"; }
export function persistLanguage(language:Language) {
  try{localStorage.setItem(LANGUAGE_COOKIE,language);}catch{/* Optional storage. */}
  try{document.cookie=`${LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=31536000; SameSite=Lax${window.location?.protocol==="https:"?"; Secure":""}`;}catch{/* Optional cookie. */}
}
// Runs in the head before the first paint. Existing localStorage preferences are
// migrated without ever painting the wrong-language page during hydration.
export const LANGUAGE_BOOTSTRAP=`try{var p=localStorage.getItem('gary-language');if(p==='en'||p==='vi'){if(document.documentElement.lang!==p){document.documentElement.dataset.languagePending='';}document.cookie='gary-language='+p+'; Path=/; Max-Age=31536000; SameSite=Lax'+(window.location?.protocol==='https:'?'; Secure':'');}}catch(e){}`;
