"use client";
import { useId,useState,type InputHTMLAttributes } from "react";
import { Eye,EyeOff } from "lucide-react";
import { useSite } from "./site-context";

export function PasswordInput({inputProps}:{inputProps:Omit<InputHTMLAttributes<HTMLInputElement>,"type">}){
 const [visible,setVisible]=useState(false),generated=useId(),{t}=useSite(),id=inputProps.id||generated;
 const empty=inputProps.value==="",[wasEmpty,setWasEmpty]=useState(empty);
 // Reset during render, before a cleared controlled field can paint revealed.
 if(empty!==wasEmpty){setWasEmpty(empty);if(empty&&visible)setVisible(false);}
 return <span className="password-control"><input {...inputProps} id={id} type={visible?"text":"password"} onChange={event=>{if(!event.target.value)setVisible(false);inputProps.onChange?.(event);}}/><button className="password-toggle" type="button" disabled={inputProps.disabled} aria-label={t(visible?"Hide password":"Show password",visible?"Ẩn mật khẩu":"Hiện mật khẩu")} aria-pressed={visible} aria-controls={id} title={t(visible?"Hide password":"Show password",visible?"Ẩn mật khẩu":"Hiện mật khẩu")} onMouseDown={event=>event.preventDefault()} onClick={event=>{event.preventDefault();setVisible(value=>!value);}}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button></span>;
}
