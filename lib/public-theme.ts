import { PUBLIC_LANDING_PATHS } from './public-routes';

export const HOME_THEME_STORAGE_KEY = 'gary-home-theme';
export const HOME_THEME_VALUES = ['light', 'dark', 'system'] as const;

// Runs before the preference provider's blocking theme bootstrap. Only public
// routes receive the residential palette; Studio/Auth keep their own styles.
export const PUBLIC_THEME_SCOPE_BOOTSTRAP = `(function(){try{var p=location.pathname.replace(/^\\/(en|vi)(?=\\/|$)/,'')||'/';p=p.replace(/\\/+$/,'')||'/';var pages=${JSON.stringify([...PUBLIC_LANDING_PATHS, '/about'])};document.documentElement.dataset.homePublic=String(pages.indexOf(p)>=0||/^\\/(homes|tips-and-news)\\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p));}catch(e){}})();`;
