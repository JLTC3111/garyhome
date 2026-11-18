import { PUBLIC_LANDING_PATHS } from './public-routes';

export const HOME_THEME_STORAGE_KEY = 'gary-home-theme';
export const HOME_THEME_VALUES = ['light', 'dark', 'system'] as const;
type HomeTheme = typeof HOME_THEME_VALUES[number];

const HOME_THEME_COOKIE_PATTERN = `(?:^|;\\s*)${HOME_THEME_STORAGE_KEY}=(${HOME_THEME_VALUES.join('|')})(?:;|$)`;
const SHARED_THEME_HOSTS = ['garyhome.vn', 'www.garyhome.vn', 'staff.garyhome.vn'];

export function isHomeTheme(value: unknown): value is HomeTheme {
  return HOME_THEME_VALUES.some(theme => theme === value);
}

export function readHomeThemeCookie() {
  try {
    const value = new RegExp(HOME_THEME_COOKIE_PATTERN).exec(document.cookie)?.[1];
    if (isHomeTheme(value)) return value;
  } catch { /* Cookie storage is optional. */ }
}

export function persistHomeTheme(theme: HomeTheme) {
  const { hostname, protocol } = window.location;
  const secure = protocol === 'https:';
  const domain = secure && SHARED_THEME_HOSTS.includes(hostname) ? '; Domain=garyhome.vn' : '';
  try {
    document.cookie = `${HOME_THEME_STORAGE_KEY}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${domain}${secure ? '; Secure' : ''}`;
  } catch { /* next-themes still stores the preference on this origin. */ }
}

// Prepare next-themes' local storage before its inline script resolves System.
export const HOME_THEME_PREFERENCE_BOOTSTRAP = `(function(key,pattern,values){
  var preference;
  try{preference=(new RegExp(pattern).exec(document.cookie)||[])[1];}catch(e){}
  try{
    var stored=localStorage.getItem(key);
    if(preference&&preference!==stored)localStorage.setItem(key,preference);
    else if(stored!==null&&values.indexOf(stored)<0)localStorage.removeItem(key);
  }catch(e){
    var theme=preference&&preference!=='system'?preference:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
    document.documentElement.setAttribute('data-home-theme',theme);
  }
})(${JSON.stringify(HOME_THEME_STORAGE_KEY)},${JSON.stringify(HOME_THEME_COOKIE_PATTERN)},${JSON.stringify(HOME_THEME_VALUES)});`;

// Runs in the head so the residential palette matches the initial route.
export const PUBLIC_THEME_SCOPE_BOOTSTRAP = `(function(){try{var p=location.pathname.replace(/^\\/(en|vi)(?=\\/|$)/,'')||'/';p=p.replace(/\\/+$/,'')||'/';var pages=${JSON.stringify([...PUBLIC_LANDING_PATHS, '/about'])};document.documentElement.dataset.homePublic=String(pages.indexOf(p)>=0||/^\\/(homes|tips-and-news)\\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p));}catch(e){}})();`;
