"use client";
import { useSearchParams } from "next/navigation";
import { Activities } from "./activities";
export function ActivitiesPage(){const category=useSearchParams().get("category");return <Activities key={category} full initialCategory={category==="feedback"||category==="team"?category:"customers"}/>;}
