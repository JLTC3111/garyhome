"use client";
import { useSite } from "./site-context";
export function PageLoading(){const {t}=useSite();return <div className="container section" role="status">{t("Loading…","Đang tải…")}</div>;}
