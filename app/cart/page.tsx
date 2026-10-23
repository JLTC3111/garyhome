import { permanentRedirect } from "next/navigation";
// Preserve old bookmarks after consolidating the shortlist into Favourites.
export default function Page(){permanentRedirect("/saved");}
