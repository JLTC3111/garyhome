'use client';

import { useLayoutEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ThemeProvider } from 'next-themes';
import { isPublicPagePath } from '@/lib/localized-routes';
import { HOME_THEME_STORAGE_KEY } from '@/lib/public-theme';

function PublicThemeScope() {
  const pathname = usePathname();
  useLayoutEffect(() => {
    document.documentElement.dataset.homePublic = String(isPublicPagePath(pathname));
  }, [pathname]);
  return null;
}

export function PublicThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeProvider attribute="data-home-theme" storageKey={HOME_THEME_STORAGE_KEY}
    defaultTheme="system" enableSystem enableColorScheme={false} disableTransitionOnChange
    themes={['light', 'dark']} scriptProps={{ id: 'gary-home-theme-bootstrap' }}>
    <PublicThemeScope/>{children}
  </ThemeProvider>;
}
