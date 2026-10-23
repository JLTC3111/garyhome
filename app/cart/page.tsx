import { pageMetadata } from "@/lib/seo";
import { CartPage } from "@/components/cart-page";
export async function generateMetadata(){return pageMetadata("/cart",true);}
export default function Page(){return <CartPage/>;}
