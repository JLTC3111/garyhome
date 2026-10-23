"use client";
import {useState} from "react";
import {ArrowDown,ArrowUp,GripVertical,Save,Settings2,X} from "lucide-react";
import {useSite} from "./site-context";
import {canReorderProperties} from "@/lib/staff";
import {applyPropertyOrder} from "@/lib/property-order";
import {listingCode,propertyTitle} from "@/lib/rentals";
import type {Property,PropertyOrderScope} from "@/lib/types";

export function PropertyOrderControls(props:{scope:PropertyOrderScope;properties:Property[]}){
 const {user,staffRole}=useSite();
 return user&&canReorderProperties(staffRole)?<OrderEditor key={user.id+props.scope} {...props}/>:null;
}
function OrderEditor({scope,properties}:{scope:PropertyOrderScope;properties:Property[]}){
 const {content,setContent,t,language,editorTask}=useSite();
 const current=content.propertyOrders?.[scope]||[];
 const [draft,setDraft]=useState<{ids:string[];expected:string[]}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[saved,setSaved]=useState(false);
 const [dragging,setDragging]=useState<string|null>(null),[moved,setMoved]=useState("");
 const items=draft?draft.ids.map(id=>properties.find(p=>p.id===id)).filter((p):p is Property=>!!p):applyPropertyOrder(properties,current);
 function open(){setDraft({ids:items.map(p=>p.id),expected:[...current]});setError("");setSaved(false);}
 function move(id:string,to:number){if(busy||!draft)return;const ids=draft.ids.filter(id=>properties.some(p=>p.id===id)),from=ids.indexOf(id);if(from<0||to<0||to>=ids.length)return;ids.splice(from,1);ids.splice(to,0,id);setDraft({...draft,ids});setMoved(`${listingCode(properties.find(p=>p.id===id)!)} · ${to+1}`);}
 async function save(reset=false){if(!draft)return;setBusy(true);setError("");const ids=reset?[]:draft.ids.filter(id=>properties.some(p=>p.id===id));
  try{const {error}=await editorTask((db,signal)=>db.rpc("save_property_order",{order_scope:scope,ordered_property_ids:ids,expected_property_ids:draft.expected}).abortSignal(signal));if(error)throw error;
   setContent(previous=>({...previous,propertyOrders:{...previous.propertyOrders,[scope]:ids}}));setDraft(null);setSaved(true);
  }catch(error){setError(error&&typeof error==="object"&&"code" in error&&error.code==="40001"?"conflict":"save");}finally{setBusy(false);}}
 return <section className="property-order-tools" aria-label={t("Card order","Thứ tự tin đăng")}>
  <div className="property-order-toolbar"><span>{current.length?t("Custom card order","Thứ tự đã sắp xếp"):t("Newest posts first","Tin mới nhất trước")}</span><button className="text-link" type="button" onClick={()=>draft?setDraft(null):open()} disabled={busy}>{draft?<X size={16}/>:<Settings2 size={16}/>} {draft?t("Close ordering","Đóng sắp xếp"):t("Arrange cards","Sắp xếp tin")}</button></div>
  {saved&&!draft&&<p role="status">{t("Card order saved.","Đã lưu thứ tự tin đăng.")}</p>}
  {draft&&<div className="property-order-editor"><p>{scope==="home"?t("Drag cards or use the arrows. The first six appear on the home page.","Kéo thẻ hoặc dùng mũi tên. Sáu tin đầu tiên xuất hiện trên trang chủ."):t("Drag cards or use the arrows to set the default listing order.","Kéo thẻ hoặc dùng mũi tên để đặt thứ tự mặc định trên trang danh sách.")}</p>
   <ol>{items.map((p,i)=><li key={p.id} draggable={!busy} className={dragging===p.id?"is-dragging":""} onDragStart={event=>{event.dataTransfer.setData("text/plain",p.id);event.dataTransfer.effectAllowed="move";setDragging(p.id);}} onDragEnd={()=>setDragging(null)} onDragOver={event=>{if(dragging)event.preventDefault();}} onDrop={event=>{event.preventDefault();if(dragging)move(dragging,i);setDragging(null);}}><GripVertical size={18} aria-hidden="true"/>{p.images[0]&&<img src={p.images[0]} alt="" width="64" height="48"/>}<span><strong>{listingCode(p)}</strong><small>{propertyTitle(p,language,content.neighbourhoods.find(n=>n.slug===p.district_slug)?.name,false)}</small></span><div><button className="icon-button" type="button" disabled={busy||i===0} onClick={()=>move(p.id,i-1)} aria-label={t(`Move ${listingCode(p)} up`,`Đưa ${listingCode(p)} lên`)}><ArrowUp size={17}/></button><button className="icon-button" type="button" disabled={busy||i===items.length-1} onClick={()=>move(p.id,i+1)} aria-label={t(`Move ${listingCode(p)} down`,`Đưa ${listingCode(p)} xuống`)}><ArrowDown size={17}/></button></div></li>)}</ol>
   <span className="sr-only" aria-live="polite">{moved}</span>{error&&<p className="form-error" role="alert">{error==="conflict"?t("This order changed. Refresh the page before saving.","Thứ tự đã thay đổi. Tải lại trang trước khi lưu."):t("Couldn’t confirm the save. Check the connection and refresh before trying again.","Chưa thể xác nhận việc lưu. Kiểm tra kết nối và tải lại trước khi thử lại.")}</p>}
   <div className="property-order-actions"><button className="button button-small" type="button" disabled={busy} onClick={()=>void save()}><Save size={16}/>{busy?t("Saving…","Đang lưu…"):t("Save order","Lưu thứ tự")}</button><button className="button button-outline button-small" type="button" disabled={busy} onClick={()=>void save(true)}>{t("Reset to newest first","Đặt lại: tin mới nhất trước")}</button></div>
  </div>}
 </section>;
}
