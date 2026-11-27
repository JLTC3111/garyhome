"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useSite } from "./site-context";

export function useMediaSelection<Row>(key:string, idOf:(row:Row)=>string, valid:(row:unknown)=>row is Row) {
  const current=useRef<{key:string;items:Map<string,Row>}|null>(null);
  const [snapshot,setSnapshot]=useState<typeof current.current>(null);
  useEffect(()=>{
    const items=new Map<string,Row>();
    try {
      const saved:unknown=JSON.parse(localStorage.getItem(key)??"[]");
      if(Array.isArray(saved))for(const row of saved)if(valid(row))items.set(idOf(row),row);
    }catch{/* Keep the selection usable in this tab. */}
    current.current={key,items};setSnapshot(current.current);
  },[key,idOf,valid]);
  const update=(change:(items:Map<string,Row>)=>void)=>{
    if(current.current?.key!==key)return;
    const items=new Map(current.current.items);
    change(items);current.current={key,items};setSnapshot(current.current);
    try{localStorage.setItem(key,JSON.stringify([...items.values()]));}catch{/* Run checkpoints are validated separately. */}
  };
  const items=snapshot?.key===key?snapshot.items:null;
  return {ready:!!items,rows:items?[...items.values()]:[],has:(id:string)=>items?.has(id)??false,
    add:(rows:Row[])=>update(next=>{for(const row of rows)next.set(idOf(row),row);}),
    remove:(ids:string[])=>update(next=>{for(const id of ids)next.delete(id);}),
    clear:()=>update(next=>next.clear())};
}

export function MediaSelectionControls({count,bytes,unknownSizes,formatBytes,allReason,pageReason,clearReason,selectAll,selectPage,clear}: {
  count:number;bytes:number;unknownSizes:number;formatBytes:(bytes:number)=>string;
  allReason:string;pageReason:string;clearReason:string;selectAll:()=>void;selectPage:()=>void;clear:()=>void;
}) {
  const {t}=useSite();
  const id=useId();
  const actions=[
    {key:"all",label:t("Select all eligible files","Chọn tất cả tệp đủ điều kiện"),reason:allReason,action:selectAll},
    {key:"page",label:t("Select current page","Chọn trang hiện tại"),reason:pageReason,action:selectPage},
    {key:"clear",label:t("Clear selection","Bỏ tất cả lựa chọn"),reason:clearReason,action:clear},
  ];
  const reasons=[...new Set(actions.map(action=>action.reason).filter(Boolean))];
  return <>
    <div className="storage-media-actions">
      {actions.map(({key,label,reason,action})=><button key={key} type="button" className="button button-outline button-small"
        disabled={!!reason} title={reason||undefined} aria-describedby={reason?`${id}-${reasons.indexOf(reason)}`:undefined} onClick={action}>{label}</button>)}
      <span role="status">{t(`${count} selected · ${formatBytes(bytes)}`,`${count} tệp đã chọn · ${formatBytes(bytes)}`)}
        {unknownSizes>0&&t(` · ${unknownSizes} sizes unknown`,` · ${unknownSizes} tệp chưa rõ dung lượng`)}</span>
    </div>
    {reasons.map((reason,index)=><small key={reason} id={`${id}-${index}`}>{reason}</small>)}
  </>;
}
