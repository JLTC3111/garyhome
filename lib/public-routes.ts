// Public landing pages are shared by sitemap generation and audit discovery.
// Detail URLs are added from published CMS records, never from drafts.
export const PUBLIC_LANDING_PATHS = [
  "/", "/homes", "/neighbourhoods", "/services", "/vinhomes",
  "/tips-and-news", "/landlords", "/contact", "/activities", "/feedback",
  "/privacy", "/credits",
] as const;
