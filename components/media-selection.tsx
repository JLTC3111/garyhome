"use client";

import { useEffect, useId, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { ChevronDown, ListChecks, LoaderCircle, Search, SquareCheck, X, type LucideIcon } from "lucide-react";
import { useSite } from "./site-context";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

const mediaButtonVariants = {primary:"confirm",secondary:"view",warning:"archive",destructive:"danger-primary"} as const;

export function MediaActionButton({icon:Icon,tone="secondary",pending=false,children,type="button",...props}:
  ComponentPropsWithoutRef<"button"> & {icon:LucideIcon;tone?:keyof typeof mediaButtonVariants;pending?:boolean}) {
  const Glyph=pending?LoaderCircle:Icon;
  return <button type={type} className="storage-media-button" data-button-variant={mediaButtonVariants[tone]} aria-busy={pending||undefined} {...props}>
    <Glyph size={16} aria-hidden="true"/>{children}
  </button>;
}

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
    change(items);
    if(items.size===current.current.items.size&&[...items].every(([id,row])=>current.current?.items.get(id)===row))return;
    current.current={key,items};setSnapshot(current.current);
    try{localStorage.setItem(key,JSON.stringify([...items.values()]));}catch{/* Run checkpoints are validated separately. */}
  };
  const items=snapshot?.key===key?snapshot.items:null;
  return {ready:!!items,rows:items?[...items.values()]:[],has:(id:string)=>items?.has(id)??false,
    add:(rows:Row[])=>update(next=>{for(const row of rows)next.set(idOf(row),row);}),
    remove:(ids:string[])=>update(next=>{for(const id of ids)next.delete(id);}),
    reconcile:(resolve:(row:Row)=>Row|null)=>update(next=>{
      for(const [id,row] of next){const live=resolve(row);if(live===null)next.delete(id);else next.set(id,live);}
    }),
    clear:()=>update(next=>next.clear())};
}

export function MediaSearchField({label,placeholder,value,onChange,onClear,canClear,disabled,maxLength}: {
  label:string;placeholder:string;value:string;onChange:(value:string)=>void;onClear:()=>void;canClear?:boolean;disabled?:boolean;maxLength?:number;
}) {
  const {t}=useSite();
  const input=useRef<HTMLInputElement>(null);
  const clearLabel=t("Clear search","Xóa tìm kiếm");
  return <div className="storage-media-search">
    <Search size={16} aria-hidden="true"/>
    <input ref={input} type="search" aria-label={label} placeholder={placeholder} value={value}
      maxLength={maxLength} autoComplete="off" spellCheck={false} disabled={disabled} onChange={event=>onChange(event.target.value)}/>
    {(value||canClear)&&<button type="button" className="storage-media-search__clear" aria-label={clearLabel} title={clearLabel}
      disabled={disabled} onClick={()=>{onClear();input.current?.focus();}}><X size={16} aria-hidden="true"/></button>}
  </div>;
}

export function MediaSelectionControls({
  count,bytes,unknownSizes,formatBytes,pageCount,pageSelected,allReason,pageReason,clearReason,selectAll,selectPage,clearPage,clear,children,
}: {
  count:number;bytes:number;unknownSizes:number;formatBytes:(bytes:number)=>string;
  pageCount:number;pageSelected:number;allReason:string;pageReason:string;clearReason:string;
  selectAll:()=>void;selectPage:()=>void;clearPage:()=>void;clear:()=>void;children?:ReactNode;
}) {
  const {t,language}=useSite();
  const id=useId();
  const number=new Intl.NumberFormat(language==="vi"?"vi-VN":"en");
  const pageChecked=pageCount>0&&pageSelected===pageCount;
  const mixed=pageSelected>0&&!pageChecked;
  const pageLabel=t("Select eligible files on this page","Chọn tệp đủ điều kiện trên trang này");
  const optionsLabel=t("Selection options","Tùy chọn lựa chọn");
  const actions=[
    {key:"all",icon:ListChecks,label:t("Select all eligible files","Chọn tất cả tệp đủ điều kiện"),reason:allReason,action:selectAll},
    {key:"page",icon:SquareCheck,label:t("Select current page","Chọn trang hiện tại"),reason:pageReason,action:selectPage},
    {key:"clear",icon:X,label:t("Clear selection","Bỏ tất cả lựa chọn"),reason:clearReason,action:clear},
  ];
  const reasons=[...new Set(actions.map(action=>action.reason).filter(Boolean))];
  const reasonId=(reason:string)=>reason?`${id}-${reasons.indexOf(reason)}`:undefined;
  const outsideView=Math.max(0,count-pageSelected);
  return <div className="storage-media-toolbar">
    <div className="storage-media-selection" data-selected={count>0}>
      <div className="storage-media-selection__switch">
        <label className="storage-media-selection__master">
          <input type="checkbox" aria-label={pageLabel} aria-checked={mixed?"mixed":pageChecked} aria-describedby={reasonId(pageReason)}
            ref={node=>{if(node)node.indeterminate=mixed;}} checked={pageChecked} disabled={!!pageReason}
            onChange={pageChecked?clearPage:selectPage}/>
        </label>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className="storage-media-selection__trigger" aria-label={optionsLabel}>
              <ChevronDown size={16} aria-hidden="true"/>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="storage-media-selection-menu" align="start" sideOffset={8} collisionPadding={12}>
            {actions.map(({key,icon:Icon,label,reason,action})=><DropdownMenuItem key={key} className="storage-media-selection-menu__item"
              disabled={!!reason} aria-describedby={reasonId(reason)} onSelect={action}><Icon size={16} aria-hidden="true"/>{label}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <span className="storage-media-selection__total" role="status">
        <strong>{t(`${number.format(count)} selected`,`${number.format(count)} tệp đã chọn`)}</strong>
        {count>0&&<small>{formatBytes(bytes)}{unknownSizes>0&&t(` · ${number.format(unknownSizes)} sizes unknown`,` · ${number.format(unknownSizes)} tệp chưa rõ dung lượng`)}
          {outsideView>0&&t(` · ${number.format(outsideView)} outside this view`,` · ${number.format(outsideView)} tệp ngoài chế độ xem này`)}</small>}
      </span>
    </div>
    {children&&<div className="storage-media-toolbar__action">{children}</div>}
    {reasons.map((reason,index)=><span key={reason} className="sr-only" id={`${id}-${index}`}>{reason}</span>)}
  </div>;
}
