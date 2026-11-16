import { pageMetadata } from "@/lib/seo";

export { default } from "../page";
export async function generateMetadata() { return pageMetadata("/"); }
