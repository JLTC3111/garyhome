import type { Metadata } from "next";
import "./globals.css";
import "./portal.css";
import "./interactions.css";
import "./portal-access.css";
import "./select.css";
import { loadContent } from "@/lib/server";
import { SiteProvider } from "@/components/site-context";
import { InteractionProvider } from "@/components/interaction-provider";
import { Header, Footer } from "@/components/site-shell";
import { DocumentTitle } from "@/components/document-title";

// Read CMS content at request time so publishing edits does not need a rebuild.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL("https://gary-home-hanoi.lsd99999999.chatgpt.site"),
  title: { default: "Gary Home — Find your place in Hanoi", template: "%s | Gary Home" },
  description: "Find a home that feels like you. Explore Gary Home’s Hanoi apartments, studios, and villas, with real property photos and personal support from a local team.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initial = await loadContent();
  return (
    <html lang="en">
      <body><InteractionProvider><SiteProvider initial={initial}><DocumentTitle/><a className="skip-link" href="#main-content">Skip to content</a><Header /><main id="main-content">{children}</main><Footer /></SiteProvider></InteractionProvider></body>
    </html>
  );
}
