import { pageMetadata } from "@/lib/seo";
import { PasswordReset } from "@/components/password-reset";
export async function generateMetadata(){return {...await pageMetadata("/auth/reset",true),referrer:"no-referrer" as const};}
export default function Page(){return <PasswordReset/>;}
