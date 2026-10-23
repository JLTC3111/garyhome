import { cookies } from "next/headers";
import { LANGUAGE_BOOTSTRAP, languageValue } from "@/lib/language";
import { loadPageContent, pageMetadata, siteUrl } from "@/lib/seo";
import type { Metadata } from "next";
import "./globals.css";
import "./portal.css";
import "./interactions.css";
import "./portal-access.css";
import "./select.css";
import "./rental.css";
import { SiteProvider } from "@/components/site-context";
import { InteractionProvider } from "@/components/interaction-provider";
import { Header, Footer } from "@/components/site-shell";
import { CartProvider } from "@/components/cart-context";
import { DocumentTitle } from "@/components/document-title";

// Read CMS content at request time so publishing edits does not need a rebuild.
export const dynamic = "force-dynamic";

export async function generateMetadata():Promise<Metadata>{
  const base=await pageMetadata("/");
  return {...base,metadataBase:new URL(siteUrl()),icons:{icon:"/favicon.svg",shortcut:"/favicon.svg"}};
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
      <head><script id="gary-language-bootstrap" dangerouslySetInnerHTML={{__html:LANGUAGE_BOOTSTRAP}}/><style>{`html[data-language-pending] body{visibility:hidden}`}</style></head>
      <body><InteractionProvider><SiteProvider initial={initial} initialLanguage={initialLanguage}><CartProvider><DocumentTitle/><a className="skip-link" href="#main-content">{initialLanguage==="vi"?"Đến nội dung chính":"Skip to content"}</a><Header /><main id="main-content">{children}</main><Footer /></CartProvider></SiteProvider></InteractionProvider></body>
    </html>
  );
}
