"use client";
import { useEffect, useId, useRef } from "react";
import { Trash2 } from "lucide-react";
import { useSite } from "./site-context";

export function DeleteConfirmation({title,description,target,busy,error,onCancel,onConfirm,confirmLabel}:{title:string;description:string;target:string;busy:boolean;error?:string;onCancel:()=>void;onConfirm:()=>void;confirmLabel?:string}){
 const {t}=useSite(),id=useId(),dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const node=dialog.current,opener=document.activeElement instanceof HTMLElement?document.activeElement:null;node?.showModal();return()=>{node?.close();if(opener?.isConnected)opener.focus({preventScroll:true});};},[]);
 return <dialog ref={dialog} className="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={event=>{event.preventDefault();if(!busy)onCancel();}} onKeyDown={event=>{if(event.key==="Escape")event.stopPropagation();}}>
  <h2 id={`${id}-title`}>{title}</h2><strong className="delete-target">{target}</strong><p id={`${id}-description`}>{description}</p>
  {error&&<p className="form-error" role="alert">{error}</p>}
  <div className="delete-dialog-actions"><button autoFocus type="button" className="button button-outline" disabled={busy} onClick={onCancel}>{t("Cancel","Hủy")}</button><button type="button" className="button button-danger" disabled={busy} onClick={onConfirm}><Trash2 size={17}/>{busy?t("Deleting…","Đang xóa…"):confirmLabel||t("Delete","Xóa")}</button></div>
 </dialog>;
}
