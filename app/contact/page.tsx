import { Suspense } from "react";
import { ContactPage } from "@/components/content-pages";
export const metadata={title:"Say hello"};
export default function Page(){return <Suspense fallback={<div className="container section">Loading…</div>}><ContactPage/></Suspense>;}
