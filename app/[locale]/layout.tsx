import type { ReactNode } from "react";
import { notFound } from "next/navigation";

export default async function LocalizedPublicLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (locale !== "en" && locale !== "vi") notFound();
  return children;
}
