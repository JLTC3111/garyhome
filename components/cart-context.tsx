"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSite } from "./site-context";
import { isPublicRental } from "@/lib/rentals";
import { request } from "@/lib/requests";

const KEY="gary-rental-cart";
const CartContext=createContext<{ids:string[];pending:string[];error:string;toggle:(id:string)=>Promise<void>;removeSubmitted:(ids:string[])=>Promise<void>;retry:()=>void}|null>(null);
function guestItems(){try{const rows=JSON.parse(localStorage.getItem(KEY)||"[]");return Array.isArray(rows)?[...new Set(rows.filter((id):id is string=>typeof id==="string"))].slice(0,12):[];}catch{return [];}}
export function CartProvider({children}:{children:ReactNode}) {
  const {client,user,sessionPhase,content,accountTask,t,notice}=useSite();
  const [loadedFor,setLoadedFor]=useState<string|null|undefined>(undefined);
  const [ids,setIds]=useState<string[]>([]),[pending,setPending]=useState<string[]>([]),[error,setError]=useState("");
  const [retryVersion,setRetryVersion]=useState(0);
  const identity=useRef<string|null>(user?.id||null),version=useRef(0),flight=useRef(new Set<string>()),active=useRef(true);
  const ownedBy=useRef<string|null>(null);
  useEffect(()=>{active.current=true;return()=>{active.current=false;version.current++;};},[]);
  useEffect(()=>{
    let cancelled=false;const id=user?.id||null;identity.current=id;
    if(ownedBy.current!==id){version.current++;ownedBy.current=null;setPending([]);setError("");}
    const generation=version.current;
    queueMicrotask(()=>{
      if(cancelled)return;
      if(!id){setIds(guestItems());setLoadedFor(null);setError("");setPending([]);return;}
      if(!client||sessionPhase!=="ready")return;
      if(ownedBy.current!==id)setIds([]);
      void request(signal=>client.from("rental_cart").select("property_id").eq("user_id",id).abortSignal(signal)).then(({data,error})=>{
        if(cancelled||identity.current!==id||version.current!==generation)return;
        if(error)throw error;
        setIds((data||[]).map(row=>row.property_id as string));setLoadedFor(id);ownedBy.current=id;setError("");
      }).catch(()=>{if(!cancelled&&identity.current===id)setError("load");});
    });
    return()=>{cancelled=true;};
  },[client,user?.id,sessionPhase,retryVersion]);
  async function toggle(id:string){
    const current=user?.id||null;const key=(current||"guest")+":"+id;
    if(flight.current.has(key)||identity.current!==current)return;
    const visible=loadedFor===(user?.id||null)?ids:[];
    const remove=visible.includes(id);
    if(!remove&&!content.properties.some(p=>p.id===id&&isPublicRental(p)))return;
    const reserved=[...flight.current].filter(key=>key.startsWith((current||"guest")+":")&&!visible.includes(key.slice(key.indexOf(":")+1))).length;
    if(!remove&&visible.length+reserved>=12){notice(t("Your cart can hold up to 12 properties.","Giỏ xem nhà chứa tối đa 12 bất động sản."));return;}
    if(!current){setIds(previous=>{const next=previous.includes(id)?previous.filter(x=>x!==id):previous.length>=12?previous:[...previous,id];try{localStorage.setItem(KEY,JSON.stringify(next));}catch{/* Per-visit fallback. */}return next;});return;}
    if(ownedBy.current!==current){setError("load");notice(t("Your cart is still connecting. Open your cart to retry.","Giỏ xem nhà đang kết nối. Mở giỏ để thử lại."));return;}
    flight.current.add(key);setPending(previous=>[...previous,id]);version.current++;
    try{
      await accountTask(async(db,signal)=>{
        const result=remove?await db.from("rental_cart").delete().eq("user_id",current).eq("property_id",id).abortSignal(signal):await db.from("rental_cart").insert({user_id:current,property_id:id}).abortSignal(signal);
        if(result.error)throw result.error;
      });
      if(active.current&&identity.current===current){setIds(previous=>remove?previous.filter(x=>x!==id):[...new Set([...previous,id])]);setError("");}
    }catch{if(active.current&&identity.current===current){setError("save");notice(t("Your cart could not be updated. Open your cart to retry.","Chưa thể cập nhật giỏ xem nhà. Mở giỏ để thử lại."));}}
    finally{flight.current.delete(key);if(active.current&&identity.current===current)setPending(previous=>previous.filter(x=>x!==id));}
  }
  const removeSubmitted=useCallback(async(submitted:string[])=>{
    const current=user?.id||null;version.current++;
    if(current)await accountTask(async(db,signal)=>{const {error}=await db.from("rental_cart").delete().eq("user_id",current).in("property_id",submitted).abortSignal(signal);if(error)throw error;});
    if(identity.current!==current||!active.current)return;
    setIds(previous=>{const next=previous.filter(id=>!submitted.includes(id));if(!current)try{localStorage.setItem(KEY,JSON.stringify(next));}catch{/* Optional storage. */}return next;});
  },[user?.id,accountTask]);
  return <CartContext.Provider value={{ids:loadedFor===(user?.id||null)?ids:[],pending:loadedFor===(user?.id||null)?pending:[],error,toggle,removeSubmitted,retry:()=>setRetryVersion(x=>x+1)}}>{children}</CartContext.Provider>;
}
export function useCart(){const cart=useContext(CartContext);if(!cart)throw new Error("CartProvider is required");return cart;}
