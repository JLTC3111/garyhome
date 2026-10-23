import { pageMetadata } from "@/lib/seo";
import { PortalAccess } from "@/components/portal-access";

export async function generateMetadata(){return pageMetadata("/login",true);}

export default function LoginPage() {
  return <PortalAccess/>;
}
