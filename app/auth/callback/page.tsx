import { pageMetadata } from "@/lib/seo";
import { PasswordReset } from "@/components/password-reset";

// Compatibility for older invitation links and Supabase dashboard redirects.
export async function generateMetadata(){return {...await pageMetadata("/auth/callback",true),referrer:"no-referrer" as const};}
export default function Page(){return <PasswordReset invitation/>;}
