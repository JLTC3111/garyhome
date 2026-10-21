import { Suspense } from "react";
import { HomesPage } from "@/components/homes-page";
export const metadata = { title: "Explore Hanoi homes" };
export default function Page() { return <Suspense fallback={<div className="container section">Loading homes…</div>}><HomesPage/></Suspense>; }
