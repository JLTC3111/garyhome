"use client";
import Link from "next/link";
import { useSite } from "@/components/site-context";
export default function NotFound(){const {t}=useSite();return <section className="container section empty-state"><h1>{t("This page is unavailable.","Trang này hiện chưa có.")}</h1><p>{t("Explore the current rental listings or contact Gary Home for help.","Khám phá các tin cho thuê hiện có hoặc liên hệ Gary Home để được hỗ trợ.")}</p><Link className="button" href="/homes">{t("Explore rentals","Khám phá nhà cho thuê")}</Link></section>;}
