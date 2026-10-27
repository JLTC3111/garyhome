"use client";

// Adapted from React Bits Branched Menu (David Haz).
// https://github.com/DavidHDev/react-bits/tree/main/src/ts-default/Micro/BranchedMenu
// MIT + Commons Clause; retained in THIRD_PARTY_NOTICES.md.
// Gary Home: controlled navigation, existing Lucide icons, native disclosure
// semantics, keyboard controls, badges and a responsive compact sidebar.
import { useId,useRef,useState,type KeyboardEvent,type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export type BranchedMenuChild={value:string;label:string;icon?:ReactNode;badge?:number};
export type BranchedMenuItem=BranchedMenuChild&{children?:BranchedMenuChild[]};
type Props={items:BranchedMenuItem[];active:string;onSelect:(value:string)=>void;label:string};
const ROW=44,PAD=6,TRUNK=10,RADIUS=8,END=25;

export function BranchedMenu({items,active,onSelect,label}:Props){
 const [open,setOpen]=useState(()=>new Set(items.filter(item=>item.children).map(item=>item.value)));
 const nav=useRef<HTMLElement>(null),id=useId();
 const activeGroup=items.find(item=>item.children?.some(child=>child.value===active))?.value;
 const [previousGroup,setPreviousGroup]=useState(activeGroup);
 if(previousGroup!==activeGroup){setPreviousGroup(activeGroup);if(activeGroup&&!open.has(activeGroup))setOpen(new Set([...open,activeGroup]));}
 function toggle(value:string){setOpen(previous=>{const next=new Set(previous);if(next.has(value))next.delete(value);else next.add(value);return next;});}
 function keyboard(event:KeyboardEvent<HTMLElement>){
  if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;
  const buttons=Array.from(nav.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])')||[]).filter(button=>!button.closest('[inert]'));
  const current=buttons.indexOf(event.target as HTMLButtonElement);if(current<0||!buttons.length)return;event.preventDefault();
  buttons[event.key==="Home"?0:event.key==="End"?buttons.length-1:(current+(event.key==="ArrowDown"?1:-1)+buttons.length)%buttons.length]?.focus();
 }
 function content(item:BranchedMenuChild){return <>{item.icon&&<span className="branched-menu__icon" aria-hidden="true">{item.icon}</span>}<span className="branched-menu__label admin-nav-label">{item.label}</span>{!!item.badge&&<span className="studio-menu-count">{item.badge}</span>}</>;}
 return <nav ref={nav} className="branched-menu studio-branched-menu" aria-label={label} onKeyDown={keyboard}>
  {items.map(item=>{
   if(!item.children)return <button key={item.value} className={`branched-menu__item branched-menu__root ${active===item.value?"selected":""}`} type="button" data-id={item.value} aria-current={active===item.value?"page":undefined} aria-label={item.label} title={item.label} onClick={()=>onSelect(item.value)}>{content(item)}</button>;
   const expanded=open.has(item.value),children=item.children,height=PAD*2+children.length*ROW;
   const rowY=(index:number)=>PAD+index*ROW+ROW/2;
   const branch=(index:number)=>`M ${TRUNK} ${rowY(index)-RADIUS} A ${RADIUS} ${RADIUS} 0 0 0 ${TRUNK+RADIUS} ${rowY(index)} H ${END}`;
   const reach=(index:number)=>`M ${TRUNK} 0 V ${rowY(index)-RADIUS} A ${RADIUS} ${RADIUS} 0 0 0 ${TRUNK+RADIUS} ${rowY(index)} H ${END}`;
   return <section key={item.value} className="branched-menu__section" data-open={expanded} data-active={activeGroup===item.value}>
    <button type="button" className="branched-menu__head" aria-label={item.label} aria-expanded={expanded} aria-controls={id+"-"+item.value} title={item.label} onClick={()=>toggle(item.value)} onKeyDown={event=>{if(event.key==="ArrowRight"&&!expanded||event.key==="ArrowLeft"&&expanded){event.preventDefault();event.stopPropagation();toggle(item.value);}}}>
     {item.icon&&<span className="branched-menu__icon" aria-hidden="true">{item.icon}</span>}<span className="branched-menu__heading-label">{item.label}</span><ChevronDown className="branched-menu__chevron" size={14} aria-hidden="true"/>
    </button>
    <div id={id+"-"+item.value} className="branched-menu__body" aria-hidden={!expanded} inert={!expanded}>
     <div className="branched-menu__fold"><div className="branched-menu__tree" style={{height}}>
      <svg className="branched-menu__lines" width="32" height={height} aria-hidden="true"><path className="branched-menu__base" d={`M ${TRUNK} 0 V ${rowY(children.length-1)-RADIUS}`}/>{children.map((child,index)=><path key={child.value} className="branched-menu__base" d={branch(index)}/>)}{children.map((child,index)=><path key={child.value} className="branched-menu__reach" d={reach(index)} pathLength={1} strokeDasharray={1} strokeDashoffset={active===child.value?0:1}/>)}</svg>
      {children.map(child=><button key={child.value} className={`branched-menu__item ${active===child.value?"selected":""}`} type="button" data-id={child.value} aria-current={active===child.value?"page":undefined} aria-label={child.label} title={child.label} tabIndex={expanded?0:-1} onClick={()=>{if(expanded)onSelect(child.value);}}>{content(child)}</button>)}
     </div></div>
    </div>
   </section>;
  })}
 </nav>;
}
