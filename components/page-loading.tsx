"use client";
import { useSite } from "./site-context";
import { LatticeLoader } from "./react-bits/lattice-loader";
export function PageLoading(){const {t}=useSite();return <div className="container section"><LatticeLoader label={t("Loading…","Đang tải…")}/></div>;}
