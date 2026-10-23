import { pageMetadata } from "@/lib/seo";
import { PasswordReset } from "@/components/password-reset";
export async function generateMetadata(){return pageMetadata("/auth/invite",true);}
export default function Page() { return <PasswordReset invitation/>; }
