"use client";
import { useCallback,useEffect,useId,useRef,useState } from "react";
import { useSite } from "./site-context";
import { readPublicFeedback,PUBLIC_FEEDBACK_EVENT,PUBLIC_FEEDBACK_STORAGE } from "@/lib/published-feedback";
import { request } from "@/lib/requests";
import type { PublicFeedback } from "@/lib/submissions";
export function usePublicFeedback(initial:PublicFeedback[]=[],unavailable=false,limit=50){
 const {publicClient}=useSite(),id=useId();const [reviews,setReviews]=useState(initial),[failed,setFailed]=useState(unavailable);const refreshRef=useRef<()=>void>(()=>{});
 const refresh=useCallback(()=>refreshRef.current(),[]);
 useEffect(()=>{
  if(!publicClient)return;const db=publicClient,abort=new AbortController();let active=true,flight=false,queued=false;
  let channel:ReturnType<typeof db.channel>|null=null,timer:ReturnType<typeof setInterval>|undefined,debounce:ReturnType<typeof setTimeout>|undefined;
  const visible=()=>document.visibilityState!=="hidden"&&navigator.onLine!==false;
  async function read(){if(!active||!visible())return;if(flight){queued=true;return;}flight=true;
   try{const data=await request(signal=>readPublicFeedback(db,limit,AbortSignal.any([signal,abort.signal])),15000);if(active){setReviews(data);setFailed(false);}}
   catch{if(active)setFailed(true);}finally{flight=false;if(active&&queued){queued=false;schedule();}}
  }
  function schedule(){if(!active||!visible())return;clearTimeout(debounce);debounce=setTimeout(()=>void read(),120);}
  function stop(){clearInterval(timer);timer=undefined;clearTimeout(debounce);if(channel){const old=channel;channel=null;void Promise.resolve(db.removeChannel(old)).catch(()=>{});}}
  function recover(){if(!visible()){stop();return;}schedule();if(!timer)timer=setInterval(schedule,30000);
   if(!channel&&typeof db.channel==="function")channel=db.channel("gary-public-feedback-"+id).on("postgres_changes",{event:"*",schema:"public",table:"feedback_public"},schedule).subscribe(status=>{if(status==="SUBSCRIBED")schedule();});
  }
  const storage=(event:StorageEvent)=>{if(event.key===PUBLIC_FEEDBACK_STORAGE)schedule();};
  refreshRef.current=schedule;recover();window.addEventListener(PUBLIC_FEEDBACK_EVENT,schedule);window.addEventListener("focus",recover);window.addEventListener("online",recover);window.addEventListener("offline",recover);window.addEventListener("storage",storage);document.addEventListener("visibilitychange",recover);
  return()=>{active=false;abort.abort();stop();refreshRef.current=()=>{};window.removeEventListener(PUBLIC_FEEDBACK_EVENT,schedule);window.removeEventListener("focus",recover);window.removeEventListener("online",recover);window.removeEventListener("offline",recover);window.removeEventListener("storage",storage);document.removeEventListener("visibilitychange",recover);};
 },[publicClient,id,limit]);
 return {reviews,failed,refresh};
}
