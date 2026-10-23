import { pageMetadata } from "@/lib/seo";
import { AccountPage } from "@/components/account-page";

export async function generateMetadata(){return pageMetadata("/account",true);}

export default function Page() { return <AccountPage/>; }
