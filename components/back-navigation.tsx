"use client";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { localizedPath, localizedRoute, unlocalizedPath } from "@/lib/localized-routes";
import { useSite } from "./site-context";

export function BackNavigation(){
 const path=usePathname(),router=useRouter(),{t}=useSite();
 if(!path||unlocalizedPath(path)==="/")return null;
 return <button type="button" className="back-navigation" aria-label={t("Back to previous page","Quay lại trang trước")} title={t("Back to previous page","Quay lại trang trước")} onClick={()=>{if(window.history.length>1)router.back();else router.push(localizedRoute(path)?localizedPath(unlocalizedPath(path).startsWith("/homes/")?"/homes":"/",localizedRoute(path)!.language):path.startsWith("/homes/")?"/homes":"/");}}><ArrowLeft size={18}/><span>{t("Back","Quay lại")}</span></button>;
}
