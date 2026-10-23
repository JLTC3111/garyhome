"use client";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useSite } from "./site-context";

export function BackNavigation(){
 const path=usePathname(),router=useRouter(),{t}=useSite();
 if(!path||path==="/")return null;
 return <button type="button" className="back-navigation" aria-label={t("Back to previous page","Quay lại trang trước")} title={t("Back to previous page","Quay lại trang trước")} onClick={()=>{if(window.history.length>1)router.back();else router.push(path.startsWith("/homes/")?"/homes":"/");}}><ArrowLeft size={18}/><span>{t("Back","Quay lại")}</span></button>;
}
