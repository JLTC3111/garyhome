import { cookies } from "next/headers";
import { LANGUAGE_BOOTSTRAP, languageValue } from "@/lib/language";
import { loadPageContent, pageMetadata, siteUrl } from "@/lib/seo";
import type { Metadata } from "next";
import "./globals.css";
import "./portal.css";
import "./portal-help.css";
import "./interactions.css";
import "./portal-access.css";
import "./select.css";
import "./rental.css";
import "./customer-experience.css";
import "./mobile-refinements.css";
import "./contact-widget.css";
import "./staff-mobile-updates.css";
import "./password-access.css";
import "./team-experience.css";
import "./studio-navigation.css";
import "./about-pages.css";
import "./collection-motion.css";
import "./area-gallery.css";
import "./shiny-button.css";
import "./editorial-studio.css";
import "./rental-id-search.css";
import "../shared/gary-apps/styles.css";
import { SiteProvider } from "@/components/site-context";
import { InteractionProvider } from "@/components/interaction-provider";
import { Header, Footer } from "@/components/site-shell";
import { DocumentTitle } from "@/components/document-title";

// Read CMS content at request time so publishing edits does not need a rebuild.
export const dynamic = "force-dynamic";

export async function generateMetadata():Promise<Metadata>{
  const base=await pageMetadata("/");
  return {...base,metadataBase:new URL(siteUrl()),icons:{icon:[{url:"/favicon.png",type:"image/png",sizes:"32x32"},{url:"/favicon-192.png",type:"image/png",sizes:"192x192"},{url:"/favicon.svg",type:"image/svg+xml",sizes:"any"}],shortcut:"/favicon.png",apple:[{url:"/apple-touch-icon.png",type:"image/png",sizes:"180x180"}]}};
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initial = await loadPageContent();
  const initialLanguage=languageValue((await cookies()).get("gary-language")?.value);
  return (
    <html lang={initialLanguage}>
      <head><link rel="preload" href="/fonts/be-vietnam-pro-regular.woff2" as="font" type="font/woff2" crossOrigin="anonymous"/><script id="gary-language-bootstrap" dangerouslySetInnerHTML={{__html:LANGUAGE_BOOTSTRAP}}/><style>{`html[data-language-pending] body{visibility:hidden}`}</style></head>
      <body><InteractionProvider><SiteProvider initial={initial} initialLanguage={initialLanguage}><DocumentTitle/><a className="skip-link" href="#main-content">{initialLanguage==="vi"?"Đến nội dung chính":"Skip to content"}</a><Header /><main id="main-content">{children}</main><Footer /></SiteProvider></InteractionProvider></body>
    </html>
  );
}
