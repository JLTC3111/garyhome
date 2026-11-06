"use client";
import { useSite } from "./site-context";
import { LatticeLoader } from "./react-bits/lattice-loader";
export function PageLoading(){const {t}=useSite();return <div className="container section page-loading" aria-busy="true"><LatticeLoader label={t("Loading…","Đang tải…")} cellSize={8} gap={3} fontSize={14}/></div>;}
