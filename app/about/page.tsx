import { permanentRedirect } from "next/navigation";
// Preserve old bookmarks while retiring the former About Gary Home page.
export default function Page(){permanentRedirect("/services");}
