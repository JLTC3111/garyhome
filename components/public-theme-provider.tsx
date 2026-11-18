'use client';

import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ThemeProvider, useTheme } from 'next-themes';
import { isPublicPagePath } from '@/lib/localized-routes';
import { HOME_THEME_PREFERENCE_BOOTSTRAP, HOME_THEME_STORAGE_KEY, isHomeTheme, persistHomeTheme, readHomeThemeCookie } from '@/lib/public-theme';

function PublicThemeScope() {
  const pathname = usePathname();
  useLayoutEffect(() => {
    document.documentElement.dataset.homePublic = String(isPublicPagePath(pathname));
  }, [pathname]);
  return null;
}

function HomeThemeSync() {
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    // Migrate existing choices once. An implicit System default can wait for
    // the user's choice or for a saved preference from the other hostname.
    if (readHomeThemeCookie()) return;
    try {
      const stored = localStorage.getItem(HOME_THEME_STORAGE_KEY);
      if (isHomeTheme(stored)) persistHomeTheme(stored);
    } catch { /* Local storage is optional. */ }
  }, []);

  useEffect(() => {
    const sync = () => {
      const stored = readHomeThemeCookie();
      if (stored && stored !== theme) setTheme(stored);
    };
    const onCookieChange = (event: CookieChangeEvent) => {
      if (event.changed.some(cookie => cookie.name === HOME_THEME_STORAGE_KEY)) sync();
    };
    const cookieStore = window.cookieStore;
    sync();
    cookieStore?.addEventListener('change', onCookieChange);
    window.addEventListener('focus', sync);
    window.addEventListener('pageshow', sync);
    return () => {
      cookieStore?.removeEventListener('change', onCookieChange);
      window.removeEventListener('focus', sync);
      window.removeEventListener('pageshow', sync);
    };
  }, [theme, setTheme]);
  return null;
}

export function PublicThemeProvider({ children }: { children: ReactNode }) {
  return <>
    <script id="gary-home-theme-preference" dangerouslySetInnerHTML={{ __html: HOME_THEME_PREFERENCE_BOOTSTRAP }}/>
    <ThemeProvider attribute="data-home-theme" storageKey={HOME_THEME_STORAGE_KEY}
      defaultTheme="system" enableSystem enableColorScheme={false} disableTransitionOnChange
      themes={['light', 'dark']} scriptProps={{ id: 'gary-home-theme-bootstrap' }}>
      <PublicThemeScope/><HomeThemeSync/>{children}
    </ThemeProvider>
  </>;
}
