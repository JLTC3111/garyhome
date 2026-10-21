import { Suspense } from "react";
import { HomesPage } from "@/components/homes-page";
export const metadata = { title: "Your saved homes" };
export default function Page() { return <Suspense fallback={<div className="container section">Loading saved homes…</div>}><HomesPage savedOnly/></Suspense>; }
