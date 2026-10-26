"use client";
import { useSearchParams } from "next/navigation";
import { Activities } from "./activities";
import type { PublicFeedback } from "@/lib/submissions";
export function ActivitiesPage({reviews=[],unavailable=false}:{reviews?:PublicFeedback[];unavailable?:boolean}){const category=useSearchParams().get("category");return <Activities key={category} full reviews={reviews} reviewsUnavailable={unavailable} initialCategory={category==="feedback"||category==="team"?category:"customers"}/>;}
