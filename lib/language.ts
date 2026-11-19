import type { Language } from "./types";
export const LANGUAGE_COOKIE="gary-language";
const LANGUAGE_DOMAIN = "garyhome.vn";
const LANGUAGE_HOSTS = [LANGUAGE_DOMAIN, `www.${LANGUAGE_DOMAIN}`, `staff.${LANGUAGE_DOMAIN}`];
const COOKIE_OPTIONS = "; Path=/; Max-Age=31536000; SameSite=Lax";
const COOKIE_LANGUAGE = /(?:^|;\s*)gary-language=(en|vi)(?=;|$)/g;

export function languageValue(value:unknown):Language { return value==="vi"?"vi":"en"; }

export function readLanguagePreference(): Language | undefined {
  try {
    const cookie = [...document.cookie.matchAll(COOKIE_LANGUAGE)].at(-1)?.[1];
    if (cookie === "en" || cookie === "vi") return cookie;
  } catch { /* Optional cookie. */ }
  try {
    const stored = localStorage.getItem(LANGUAGE_COOKIE);
    return stored === "en" || stored === "vi" ? stored : undefined;
  } catch { return undefined; }
}

export function persistLanguage(language:Language) {
  try {
    const { protocol, hostname } = window.location;
    const secure = protocol === "https:";
    const shared = secure && LANGUAGE_HOSTS.includes(hostname);
    if (shared && hostname !== LANGUAGE_DOMAIN) {
      document.cookie = `${LANGUAGE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
    }
    document.cookie = `${LANGUAGE_COOKIE}=${language}${COOKIE_OPTIONS}${shared ? `; Domain=${LANGUAGE_DOMAIN}` : ""}${secure ? "; Secure" : ""}`;
  } catch { /* Optional cookie. */ }
  try{localStorage.setItem(LANGUAGE_COOKIE,language);}catch{/* Optional storage. */}
}

// Migrate the legacy host cookie before hydration and apply the route language.
export const LANGUAGE_BOOTSTRAP = `(function(key,domain,hosts,options){
  var path=window.location, secure=path.protocol==='https:', shared=secure&&hosts.indexOf(path.hostname)>=0;
  var match=(path.pathname||'').match(/^\\/(en|vi)(?:\\/|$)/), explicit=match&&match[1];
  function savedCookie(){try{var matches=Array.from(document.cookie.matchAll(${COOKIE_LANGUAGE}));return matches.length?matches[matches.length-1][1]:null;}catch(e){return null;}}
  var legacy=savedCookie(), preferred=legacy;
  if(shared&&path.hostname!==domain&&legacy){
    try{document.cookie=key+'=; Path=/; Max-Age=0; SameSite=Lax; Secure';preferred=savedCookie()||legacy;}catch(e){}
  }
  if(!preferred){try{var stored=localStorage.getItem(key);if(stored==='en'||stored==='vi')preferred=stored;}catch(e){}}
  preferred=preferred||explicit;
  if(preferred){
    var pageLanguage=explicit||preferred;
    if(document.documentElement.lang!==pageLanguage)document.documentElement.dataset.languagePending='';
    try{document.cookie=key+'='+preferred+options+(shared?'; Domain='+domain:'')+(secure?'; Secure':'');}catch(e){}
    try{localStorage.setItem(key,preferred);}catch(e){}
  }
})(${JSON.stringify(LANGUAGE_COOKIE)},${JSON.stringify(LANGUAGE_DOMAIN)},${JSON.stringify(LANGUAGE_HOSTS)},${JSON.stringify(COOKIE_OPTIONS)});`;
