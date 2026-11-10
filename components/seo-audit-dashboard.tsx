"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Download, LoaderCircle, RefreshCw, Search, XCircle } from "lucide-react";
import { useSite } from "./site-context";
import { canManageStaff } from "@/lib/staff";
import { fetchWithDeadline } from "@/lib/requests";
import type { AuditRun, AuditSnapshot, CrawlLimits } from "@/lib/seo-audit/store";
import type { Finding, Severity } from "@/lib/seo-analysis/types";

type Category = "content" | "technical";
const explicitNoindex=(page:{technical:{findings:Finding[]}})=>page.technical.findings.some(f=>f.id==="technical-indexability"&&f.severity==="critical");
const activeStatus=(status?:string)=>status==="queued"||status==="running";
function Signal({severity}:{severity:Severity}){
 const Icon=severity==="passed"?CheckCircle2:severity==="critical"?XCircle:AlertTriangle;
 return <Icon size={17} aria-hidden="true" className={"seo-signal seo-"+severity}/>;
}
function Score({label,value}:{label:string;value:number|null}){
 return <div className="seo-score"><span>{label}</span><strong className={value===null?"":value===100?"seo-passed":"seo-warning"}>{value===null?"—":value}<small>{value===null?"":" / 100"}</small></strong><progress value={value||0} max="100" aria-label={label}/></div>;
}
export function SeoAuditDashboard(){
 const {client,user,demo,language,staffRole}=useSite();
 const t=useCallback((en:string,vi:string)=>language==="vi"?vi:en,[language]);
 const [snapshot,setSnapshot]=useState<AuditSnapshot|null>(null),[actor,setActor]=useState<string>(),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [category,setCategory]=useState<Category>("technical"),[query,setQuery]=useState(""),[severity,setSeverity]=useState("all"),[locale,setLocale]=useState("all"),[indexing,setIndexing]=useState("all"),[selectedId,setSelectedId]=useState("");
 const identity=useRef(user?.id),sequence=useRef(0),mounted=useRef(false);
 useLayoutEffect(()=>{identity.current=user?.id;},[user?.id]);
 const data=actor===user?.id?snapshot:null;
 const call=useCallback(async(method:string,input?:unknown,runId?:string)=>{
  if(!client||!user)throw new Error(t("Sign in to access SEO audits.","Đăng nhập để xem kiểm tra SEO."));
  const account=user.id,order=++sequence.current;
  const {data:session,error}=await client.auth.getSession();
  if(error||!session.session||session.session.user.id!==account||identity.current!==account)throw new Error(t("Your account changed. Sign in again.","Tài khoản đã thay đổi. Vui lòng đăng nhập lại."));
  const response=await fetchWithDeadline("/api/admin/seo"+(runId?"?runId="+encodeURIComponent(runId):""),{
   method,cache:"no-store",headers:{Authorization:"Bearer "+session.session.access_token,...(input?{"Content-Type":"application/json"}:{})},...(input?{body:JSON.stringify(input)}:{})
  },35000);
  const result=await response.json() as AuditSnapshot&{error?:string};
  if(!response.ok)throw new Error(result.error||t("Couldn’t load SEO audits.","Không thể tải kiểm tra SEO."));
  if(mounted.current&&identity.current===account&&order===sequence.current){setSnapshot(result);setActor(account);setError("");}
 },[client,user,t]);
 const execute=useCallback(async(method:string,input?:unknown,runId?:string)=>{
  const account=user?.id;setBusy(true);setError("");
  try{await call(method,input,runId);}catch(issue){if(mounted.current&&identity.current===account)setError(issue instanceof Error?issue.message:"SEO request failed.");}
  finally{if(mounted.current&&identity.current===account)setBusy(false);}
 },[call,user?.id]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(demo||!user)return;let cancelled=false;queueMicrotask(()=>{if(!cancelled)void execute("GET");});return()=>{cancelled=true;};},[demo,user,execute]);
 const active=data?.activeRun;
 useEffect(()=>{
  if(!active||!activeStatus(active.status)||busy||error)return;
  const timer=setTimeout(()=>void execute("POST",{action:"advance",runId:active.id},selectedId),2500);
  return()=>clearTimeout(timer);
 },[active,busy,error,execute,selectedId]);
 const selected=data?.selectedRun||active;
 const pages=selected?.state.pages||[];
 const languages=[...new Set(pages.map(page=>page.language).filter(Boolean))];
 const critical=pages.flatMap(page=>page.technical.findings.filter(f=>f.severity==="critical").map(f=>({url:page.url,finding:f})));
 const visible=pages.filter(page=>(indexing==="all"||(indexing==="noindex"?explicitNoindex(page):indexing==="unavailable"?!page.indexable&&!explicitNoindex(page):page.indexable))
  &&(locale==="all"||page.language===locale)&&(page.url+" "+page[category].findings.map(f=>f.title).join(" ")).toLocaleLowerCase().includes(query.toLocaleLowerCase())
  &&(severity==="all"||page[category].findings.some(f=>f.severity===severity)));
 const labelSeverity=(value:string)=>({critical:t("Critical","Nghiêm trọng"),warning:t("Warning","Cảnh báo"),recommendation:t("Recommendation","Đề xuất"),passed:t("Passed","Đạt")}[value]||value);
 const statusLabel=(value:string)=>({queued:t("Queued","Đang chờ"),running:t("Running","Đang quét"),completed:t("Completed","Hoàn tất"),incomplete:t("Incomplete","Chưa hoàn tất"),failed:t("Failed","Thất bại")}[value]||value);
 async function settings(event:FormEvent<HTMLFormElement>){
  event.preventDefault();const form=new FormData(event.currentTarget);
  const limits:CrawlLimits={maxUrls:Number(form.get("maxUrls")),maxDepth:Number(form.get("maxDepth")),concurrency:Number(form.get("concurrency")),requestIntervalMs:Number(form.get("interval"))*1000,timeoutMs:Number(form.get("timeout"))*1000,maxDurationMs:Number(form.get("duration"))*60000};
  await execute("PATCH",{weeklyEnabled:form.get("weekly")==="on",limits},selectedId);
 }
 function download(run:AuditRun){
  const blob=new Blob([JSON.stringify({reportVersion:1,generatedAt:new Date().toISOString(),run},null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`gary-home-seo-${run.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function findingRow(finding:Finding){return <div className="seo-finding" key={finding.id}><Signal severity={finding.severity}/><div><strong>{finding.title}</strong><span className="seo-severity">{labelSeverity(finding.severity)}</span><p>{finding.explanation}</p>{finding.evidence&&<code>{finding.evidence}</code>}{finding.severity!=="passed"&&<p className="seo-fix">{finding.recommendation}</p>}</div></div>;}
 if(demo)return <section className="admin-panel seo-workspace"><h2>{t("SEO Overview","Tổng quan SEO")}</h2><p>{t("Sign in with a staff account to crawl published pages and save audit history. Live editor checks are available in preview mode.","Đăng nhập tài khoản nhân viên để quét trang đã xuất bản và lưu lịch sử. Kiểm tra trực tiếp trong trình soạn thảo có sẵn ở chế độ xem trước.")}</p></section>;
 return <div className="seo-workspace">
  <section className="admin-panel"><header className="seo-toolbar"><div><h2>{t("SEO Overview","Tổng quan SEO")}</h2><p>{t("Published pages · independent content and technical reports","Trang đã xuất bản · báo cáo nội dung và kỹ thuật độc lập")}</p></div><div className="seo-actions"><button type="button" className="button button-outline button-small" disabled={busy} onClick={()=>void execute("GET",undefined,selectedId)}><RefreshCw size={15}/>{t("Refresh","Làm mới")}</button><button type="button" className="button button-small" disabled={busy||!!active} onClick={()=>{setSelectedId("");void execute("POST",{action:"start"});}}>{busy?<LoaderCircle size={15} className="spin"/>:<Search size={15}/>} {t("Run site audit","Quét toàn website")}</button></div></header>
   {error&&<p role="alert" className="form-error">{error}</p>}
   {!data&&!busy&&!error&&<p>{t("No audit data yet. Run your first site audit.","Chưa có dữ liệu. Bắt đầu lần kiểm tra đầu tiên.")}</p>}
   {active&&<div className="seo-progress" role="status"><LoaderCircle size={18} className="spin"/><span>{statusLabel(active.status)} · {active.page_count} {t("page variants inspected","biến thể trang đã kiểm tra")} · {active.state.queue.length} {t("queued","đang chờ")}</span><small>{t("Progress is saved between batches. Scheduled workers can continue after you close this page.","Tiến độ được lưu sau mỗi đợt. Tác vụ lịch có thể tiếp tục khi đóng trang này.")}</small></div>}
   {selected&&<><div className="seo-scores"><Score label="Content SEO" value={selected.content_score}/><Score label="Technical SEO" value={selected.technical_score}/></div><p className="seo-note">{t("Scores show the percentage of applicable scored checks passed, not Google rankings. Advisory recommendations do not affect scores. Response timing is not a Core Web Vitals measurement.","Điểm là tỷ lệ kiểm tra phù hợp được chấm đã đạt, không phải thứ hạng Google. Đề xuất tư vấn không ảnh hưởng điểm. Thời gian phản hồi không phải phép đo Core Web Vitals.")}</p><div className="seo-toolbar"><p>{statusLabel(selected.status)} · {selected.page_count} {t("page variants","biến thể trang")} · {selected.scope==="page"?t("Individual-page rescan","Quét lại một trang"):t("Site audit","Kiểm tra website")} · {new Date(selected.created_at).toLocaleString(language==="vi"?"vi-VN":"en-GB")}</p><button type="button" className="text-link" onClick={()=>download(selected)}><Download size={15}/>{t("Download report","Tải báo cáo")}</button></div>{selected.status==="incomplete"&&<p className="seo-warning">{t("Partial coverage: review skipped URLs before comparing this run with previous audits.","Phạm vi chưa đầy đủ: xem URL đã bỏ qua trước khi so sánh với lần kiểm tra trước.")}</p>}{selected.state.error&&<p role="alert" className="form-error">{selected.state.error}</p>}</>}
  </section>
  {!!critical.length&&<section className="seo-critical-banner" aria-label={t("Critical technical issues","Lỗi kỹ thuật nghiêm trọng")}><h3><XCircle size={19}/>{critical.length} {t("critical technical findings","lỗi kỹ thuật nghiêm trọng")}</h3><p>{t("These can prevent crawling or indexing, regardless of the content score.","Các lỗi này có thể ngăn thu thập hoặc lập chỉ mục, bất kể điểm nội dung.")}</p>{critical.slice(0,6).map(({url,finding},i)=><div key={url+finding.id+i}><strong>{finding.title}</strong><code>{url}</code><span>{finding.recommendation}</span></div>)}{critical.length>6&&<p>{t("See Technical SEO for all critical findings.","Xem Technical SEO để biết tất cả lỗi nghiêm trọng.")}</p>}</section>}
  {selected&&<section className="admin-panel"><header className="seo-toolbar"><h2>{t("Page audit","Kiểm tra từng trang")}</h2><span>{pages.filter(explicitNoindex).length} {t("public noindex pages","trang công khai noindex")}</span></header>
   <div className="seo-category-tabs" role="tablist" aria-label={t("SEO category","Loại SEO")}>{(["content","technical"] as const).map(value=><button type="button" role="tab" aria-selected={category===value} key={value} onClick={()=>setCategory(value)}>{value==="content"?"Content SEO":"Technical SEO"}</button>)}</div>
   <div className="seo-filters"><label>{t("Search pages","Tìm trang")}<input value={query} onChange={e=>setQuery(e.target.value)} placeholder={t("URL or finding","URL hoặc kết quả")}/></label><label>{t("Severity","Mức độ")}<select value={severity} onChange={e=>setSeverity(e.target.value)}><option value="all">{t("All severities","Tất cả mức độ")}</option>{["critical","warning","recommendation","passed"].map(value=><option key={value} value={value}>{labelSeverity(value)}</option>)}</select></label><label>{t("Language","Ngôn ngữ")}<select value={locale} onChange={e=>setLocale(e.target.value)}><option value="all">{t("All languages","Tất cả ngôn ngữ")}</option>{languages.map(value=><option key={value} value={value}>{value}</option>)}</select></label><label>{t("Indexability","Lập chỉ mục")}<select value={indexing} onChange={e=>setIndexing(e.target.value)}><option value="indexable">{t("Indexable pages","Trang có thể lập chỉ mục")}</option><option value="noindex">{t("Public noindex pages","Trang công khai noindex")}</option><option value="unavailable">{t("Unavailable / non-indexable","Không khả dụng / không thể lập chỉ mục")}</option><option value="all">{t("All inspected pages","Tất cả biến thể trang đã kiểm tra")}</option></select></label></div>
   {indexing==="noindex"&&<p className="seo-note">{t("Review whether each restriction is intentional. Crawling alone cannot determine your indexing intent.","Xác nhận từng giới hạn có chủ đích hay không. Việc quét không thể xác định ý định lập chỉ mục của bạn.")}</p>}
   <div className="seo-page-list">{visible.map(page=>{const findings=page[category].findings.filter(f=>severity==="all"||f.severity===severity),worst=page[category].findings.find(f=>f.severity==="critical")||page[category].findings.find(f=>f.severity==="warning")||page[category].findings.find(f=>f.severity==="recommendation");return <details key={page.url+":"+page.language} className="seo-page"><summary><Signal severity={worst?.severity||"passed"}/><div><strong>{new URL(page.url).pathname}{page.language?` · ${page.language}`:""}</strong><small>{page.status||t("No response","Không phản hồi")} · {explicitNoindex(page)?"noindex":page.indexable?t("Indexable","Có thể lập chỉ mục"):t("Unavailable / non-indexable","Không khả dụng / không thể lập chỉ mục")} · {findings.filter(f=>f.severity!=="passed").length} {t("findings","kết quả")}</small></div><span>{page[category].score===null?"—":`${page[category].score}%`}</span></summary><div className="seo-page-detail"><code>{page.finalUrl}</code><button type="button" className="button button-outline button-small" disabled={busy||!!active} onClick={()=>{setSelectedId("");void execute("POST",{action:"start",url:page.url});}}><RefreshCw size={14}/>{t("Rescan this page","Quét lại trang này")}</button>{findings.map(findingRow)}</div></details>;})}{!visible.length&&<p>{t("No pages match these filters.","Không có trang phù hợp bộ lọc.")}</p>}</div>
   {!!(selected.state.skippedUrls.length||selected.state.omittedSkipped)&&<details className="seo-skipped"><summary>{selected.state.skippedUrls.length+(selected.state.omittedSkipped||0)} {t("skipped URLs / limits","URL đã bỏ qua / giới hạn")}</summary><ul>{selected.state.skippedUrls.map((skip,i)=><li key={skip.url+i}><code>{skip.url}</code><span>{skip.reason}</span></li>)}</ul>{!!selected.state.omittedSkipped&&<p>{selected.state.omittedSkipped} {t("additional skipped URLs omitted from the detail list to bound report size.","URL bỏ qua khác được lược khỏi danh sách chi tiết để giới hạn kích thước báo cáo.")}</p>}</details>}
  </section>}
  {data&&<section className="admin-panel"><header><h2>{t("Audit history","Lịch sử kiểm tra")}</h2><p>{t("Latest 20 runs. Compare site scans with similar page coverage; individual rescans do not replace full-site results.","20 lần gần nhất. So sánh các lần quét website có phạm vi tương đồng; quét lại một trang không thay thế kết quả toàn website.")}</p></header><History runs={data.runs} t={t}/><div className="seo-history-wrap"><table className="seo-history"><thead><tr><th>{t("Run","Lần kiểm tra")}</th><th>{t("Coverage","Phạm vi")}</th><th>Content SEO</th><th>Technical SEO</th><th>{t("Status","Trạng thái")}</th></tr></thead><tbody>{data.runs.map(run=><tr key={run.id}><td><button type="button" className="text-link" disabled={busy} onClick={()=>{setSelectedId(run.id);void execute("GET",undefined,run.id);}}>{new Date(run.created_at).toLocaleString(language==="vi"?"vi-VN":"en-GB")}</button></td><td>{run.scope==="page"?t("Single page","Một trang"):t("Site","Website")} · {run.page_count}</td><td>{run.content_score===null?"—":run.content_score+"%"}</td><td>{run.technical_score===null?"—":run.technical_score+"%"}</td><td>{statusLabel(run.status)}</td></tr>)}</tbody></table></div>{!data.runs.length&&<p>{t("No saved runs yet.","Chưa có lần kiểm tra được lưu.")}</p>}</section>}
  {data&&<section className="admin-panel"><h2>{t("Crawl settings & weekly audits","Cấu hình quét & lịch hàng tuần")}</h2><p>{t("Only configured public domains are crawled. Private routes, assets and robots-blocked URLs are excluded. External links are inspected without crawling external websites.","Chỉ quét tên miền công khai đã cấu hình. Loại trừ trang riêng tư, tài nguyên và URL bị robots chặn. Kiểm tra liên kết ngoài mà không quét website ngoài.")}</p>{canManageStaff(staffRole)?<form className="seo-settings" key={JSON.stringify(data.settings)} onSubmit={event=>void settings(event)}><label className="seo-weekly"><input type="checkbox" name="weekly" defaultChecked={data.settings.weeklyEnabled}/>{t("Enable weekly site audits","Bật kiểm tra website hàng tuần")}</label><p className="seo-note">{t("Requires the scheduled worker to be configured. Next eligible run:","Cần cấu hình tác vụ lịch. Lần tiếp theo đủ điều kiện:")} {new Date(data.settings.nextRunAt).toLocaleString(language==="vi"?"vi-VN":"en-GB")}</p><div className="seo-filters">{[
    ["maxUrls",t("Maximum pages","Số trang tối đa"),data.settings.limits.maxUrls,1,500,1],
    ["maxDepth",t("Maximum depth","Độ sâu tối đa"),data.settings.limits.maxDepth,0,4,1],
    ["concurrency",t("Concurrent requests","Yêu cầu đồng thời"),data.settings.limits.concurrency,1,2,1],
    ["interval",t("Seconds between requests / host","Giây giữa yêu cầu / máy chủ"),data.settings.limits.requestIntervalMs/1000,1,60,0.1],
    ["timeout",t("Request timeout (seconds)","Thời gian chờ (giây)"),data.settings.limits.timeoutMs/1000,1,10,1],
    ["duration",t("Audit limit (minutes)","Giới hạn quét (phút)"),data.settings.limits.maxDurationMs/60000,1,15,1],
   ].map(([name,label,value,min,max,step])=><label key={name}>{label}<input required type="number" name={String(name)} defaultValue={value} min={min} max={max} step={step}/></label>)}</div><button className="button button-small" disabled={busy} type="submit">{t("Save crawl settings","Lưu cấu hình quét")}</button></form>:<p>{t("Schedule and crawl limits can be changed by an owner, administrator or manager.","Chủ sở hữu, quản trị viên hoặc quản lý có thể thay đổi lịch và giới hạn quét.")}</p>}</section>}
 </div>;
}
function History({runs,t}:{runs:AuditSnapshot["runs"];t:(en:string,vi:string)=>string}){
 const points=runs.filter(run=>run.scope==="site"&&run.status==="completed").slice(0,20).reverse();
 if(points.length<2)return null;
 const line=(key:"content_score"|"technical_score")=>points.flatMap((point,index)=>point[key]===null?[]:[`${12+index*576/(points.length-1)},${105-(point[key]||0)}`]).join(" ");
 return <figure className="seo-trend"><svg viewBox="0 0 600 120" role="img" aria-label={t("Completed site audit pass-rate trends. Content is green; technical is orange.","Xu hướng tỷ lệ đạt của kiểm tra website hoàn tất. Nội dung màu xanh, kỹ thuật màu cam.")}><path d="M12 5V105H588" fill="none" stroke="currentColor" opacity=".2"/><polyline points={line("content_score")} fill="none" stroke="#297759" strokeWidth="3"/><polyline points={line("technical_score")} fill="none" stroke="#ad661a" strokeWidth="3"/></svg><figcaption>{t("Completed site audits, oldest → newest · Content SEO (green), Technical SEO (orange). Page coverage can vary; see the table.","Kiểm tra website hoàn tất, cũ → mới · Content SEO (xanh), Technical SEO (cam). Số trang có thể khác nhau; xem bảng.")}</figcaption></figure>;
}
