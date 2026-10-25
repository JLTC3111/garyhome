"use client";
import { useCallback,useEffect,useId,useRef,useState } from "react";
import { Bell,CheckCheck,ChevronDown,LoaderCircle,RefreshCw,X } from "lucide-react";
import { useSite } from "./site-context";
import { request } from "@/lib/requests";
import { notificationActions,type StudioNotification,type StudioCategory } from "@/lib/studio-notifications";

export function StudioNotifications({navigate}:{navigate:(category:StudioCategory)=>void}){
 const {client,user,sessionPhase,editorTask,t,language}=useSite();
 const [open,setOpen]=useState(false),[items,setItems]=useState<StudioNotification[]>([]),[unread,setUnread]=useState(0),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false),[more,setMore]=useState(false);
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),active=useRef(true),sequence=useRef(0),id=useId();
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const load=useCallback(async(older?:StudioNotification)=>{
  const read=++sequence.current;setLoading(true);
  try{if(!client)return;const {data,error}=await request(signal=>client.rpc("get_studio_notifications",{before_time:older?.created_at||null,before_id:older?.id||null,page_size:30}).abortSignal(signal));
   if(error||!Array.isArray(data?.items))throw new Error();if(!active.current||read!==sequence.current)return;
   setItems(previous=>older?[...new Map([...previous,...data.items].map((row:StudioNotification)=>[row.id,row])).values()]:data.items);setUnread(Number(data.unread_count)||0);setMore(data.items.length===30);setFailed(false);
  }catch{if(active.current&&read===sequence.current)setFailed(true);}finally{if(active.current&&read===sequence.current)setLoading(false);}
 },[client,user?.id]);
 useEffect(()=>{if(!client||!user)return;void load();const refresh=()=>void load();window.addEventListener("gary-team-access-changed",refresh);
  const channel=client&&typeof client.channel==="function"?client.channel("gary-studio-notifications-"+user?.id).on("postgres_changes",{event:"INSERT",schema:"public",table:"studio_notifications"},refresh).subscribe():null;
  return()=>{window.removeEventListener("gary-team-access-changed",refresh);if(channel&&client)void client.removeChannel(channel);};
 },[client,user?.id,load]);
 useEffect(()=>{if(!open)return;panel.current?.querySelector<HTMLElement>('button')?.focus();
  const key=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.stopPropagation();setOpen(false);trigger.current?.focus();}};
  const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
  window.addEventListener("keydown",key);document.addEventListener("pointerdown",outside);return()=>{window.removeEventListener("keydown",key);document.removeEventListener("pointerdown",outside);};
 },[open]);
 async function markRead(){
  try{const {error}=await editorTask((db,signal)=>db.rpc("mark_studio_notifications_read").abortSignal(signal));if(error)throw error;if(!active.current)return;setUnread(0);setItems(rows=>rows.map(row=>({...row,unread:false})));}
  catch{if(active.current)setFailed(true);}
 }
 return <div className="studio-notifications" ref={root}><button className="icon-button studio-notification-trigger" type="button" ref={trigger} aria-label={t("Notifications and activity log","Thông báo và nhật ký hoạt động")+(unread?` · ${unread}`:"")} aria-haspopup="dialog" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>{setOpen(!open);if(!open)void load();}}><Bell size={19}/>{unread>0&&<span className="notification-count">{unread>99?"99+":unread}</span>}</button>
 {open&&<div className="studio-notification-panel" ref={panel} role="dialog" aria-modal="false" aria-labelledby={id+"-title"} id={id}><header><div><h2 id={id+"-title"}>{t("Activity & notifications","Hoạt động & thông báo")}</h2><small>{t("Team access, enquiries and feedback","Quyền nhân viên, yêu cầu và phản hồi")}</small></div><button className="icon-button" type="button" aria-label={t("Close notifications","Đóng thông báo")} onClick={()=>{setOpen(false);trigger.current?.focus();}}><X size={18}/></button></header>
 <div className="notification-toolbar"><button className="text-link" type="button" disabled={loading} onClick={()=>void load()}><RefreshCw size={14}/>{t("Refresh","Tải lại")}</button><button className="text-link" type="button" disabled={!unread||loading} onClick={()=>void markRead()}><CheckCheck size={15}/>{t("Mark all read","Đánh dấu đã đọc")}</button></div>
 {failed&&<p className="form-error" role="alert">{t("Couldn’t refresh activity. Reconnect and try again.","Chưa thể tải hoạt động. Kết nối lại rồi thử lại.")}</p>}
 {!items.length&&!loading&&!failed&&<p className="notification-empty">{t("New activity will appear here. Earlier actions are not recreated.","Hoạt động mới sẽ xuất hiện tại đây. Không tạo lại nhật ký cho các thao tác trước đây.")}</p>}
 <ul>{items.map(item=>{const roleName=(value:string)=>t(value==="owner"?"Owner":value==="admin"?"Administrator":value==="manager"?"Manager":value==="editor"?"Staff":value,value==="owner"?"Chủ sở hữu":value==="admin"?"Quản trị viên":value==="manager"?"Quản lý":value==="editor"?"Nhân viên":value);const photo=item.actor_avatar_path&&client?client.storage.from("staff-avatars").getPublicUrl(item.actor_avatar_path).data.publicUrl:"";return <li key={item.id}><button type="button" data-unread={item.unread} onClick={()=>{navigate(item.category);setOpen(false);}}><span className="notification-avatar">{photo?<img src={photo} alt=""/>:<Bell size={15}/>}</span><span><strong>{t(...(notificationActions[item.action]||["Studio activity","Hoạt động Studio"]))}</strong>{(item.target_name||item.actor_name)&&<span>{item.actor_name||(item.actor_user_id?t("Team member","Thành viên"):t("System","Hệ thống"))}{item.target_name?" · "+item.target_name:""}</span>}{typeof item.details.from==="string"&&typeof item.details.to==="string"&&<small>{roleName(item.details.from)} → {roleName(item.details.to)}</small>}<time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString(language==="vi"?"vi-VN":"en-GB",{timeZone:"Asia/Ho_Chi_Minh"})}</time></span>{item.unread&&<i className="notification-unread-dot" aria-label={t("Unread","Chưa đọc")}/>}</button></li>;})}</ul>
 {loading&&<p className="notification-loading" role="status"><LoaderCircle size={16} className="spin"/>{t("Loading…","Đang tải…")}</p>}{more&&items.length>0&&<button className="text-link notification-load-more" type="button" disabled={loading} onClick={()=>void load(items[items.length-1])}>{t("Load older activity","Tải hoạt động trước")}<ChevronDown size={14}/></button>}
 </div>}
 </div>;
}
