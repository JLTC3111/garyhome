import { permanentRedirect } from "next/navigation";
import { requestLanguage } from "@/lib/seo";
import { headers } from "next/headers";
import { localizedPath } from "@/lib/localized-routes";
// Preserve retired bookmarks and keep an explicit language when present.
export default async function Page(){const explicit=(await headers()).get("x-gary-language");permanentRedirect(explicit?localizedPath("/services",await requestLanguage()):"/services");}
