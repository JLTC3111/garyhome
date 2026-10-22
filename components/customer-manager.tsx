"use client";
import { SelectField } from "./select-field";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, CalendarDays, Check, LoaderCircle, Mail, MessageSquare, Phone, Plus, RefreshCw, Search, UserRound, Users, X } from "lucide-react";
import { useSite } from "./site-context";
import { CUSTOMER_STAGES, customerError, customerSummaries, enquiryLabel, hanoiDay, type CustomerSummary } from "@/lib/customer-data";
import { request } from "@/lib/requests";
import { normalize } from "@/lib/property-search";
import type { CustomerProfile, CustomerRecord, Enquiry } from "@/lib/types";

export function CustomerManager({ openEnquiry }: { openEnquiry: (enquiry: Enquiry) => void }) {
  const { t, client, user, editor, sessionPhase, editorTask, language, enquiries, content, notice, demo } = useSite();
  const [profiles, setProfiles] = useState<CustomerProfile[]>([]), [records, setRecords] = useState<CustomerRecord[]>([]);
  const [query, setQuery] = useState(""), [stage, setStage] = useState(""), [dueOnly, setDueOnly] = useState(false);
  const [editing, setEditing] = useState<CustomerSummary | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [today, setToday] = useState(hanoiDay);
  const active = useRef(true), sequence = useRef(0), version = useRef(0);
  const userId = user?.id;
  const identity = useRef(userId), locale = useRef(language);
  useEffect(() => { identity.current = userId; locale.current = language; }, [userId, language]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const load = useCallback(async () => {
    if (!client || !userId || !editor || demo) return;
    const id = userId, read = ++sequence.current, startedVersion = version.current;
    setLoading(true);
    try {
      const [p, r] = await request(signal => Promise.all([
        client.from("customer_profiles").select("*").order("updated_at", { ascending: false }).abortSignal(signal),
        client.from("customer_records").select("*").order("updated_at", { ascending: false }).abortSignal(signal),
      ]));
      if (!active.current || read !== sequence.current || identity.current !== id || version.current !== startedVersion) return;
      if (p.error || r.error) throw p.error || r.error;
      setProfiles(p.data as CustomerProfile[]); setRecords(r.data as CustomerRecord[]); setToday(hanoiDay()); setError("");
    } catch (error) { if (active.current && identity.current === id && read === sequence.current) setError(customerError(error, locale.current)); }
    finally { if (active.current && read === sequence.current) setLoading(false); }
  }, [client, userId, editor, demo]);
  useEffect(() => {
    let cancelled = false;
    if (sessionPhase === "ready") queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; };
  }, [sessionPhase, load]);
  const customers = customerSummaries(profiles, enquiries, records);
  const due = (customer: CustomerRecord) => customer.stage !== "closed" && !!customer.follow_up_on && customer.follow_up_on <= today;
  const filtered = customers.filter(customer => (!stage || customer.stage === stage) && (!dueOnly || due(customer)) && normalize(`${customer.name} ${customer.email} ${customer.phone}`).includes(normalize(query).trim()));
  const stageLabel = (value: string) => ({ new: t("New lead", "Khách mới"), contacted: t("In conversation", "Đang trao đổi"), viewing: t("Viewing", "Đang xem nhà"), tenant: t("Tenant", "Khách thuê"), closed: t("Closed", "Đã hoàn tất") }[value] ?? value);
  function addCustomer() {
    setEditing({ customer_key: "manual:" + crypto.randomUUID(), user_id: null, name: "", email: "", phone: "", stage: "new", follow_up_on: null, notes: "", updated_at: "", profile: null, enquiries: [] }); setError("");
  }
  function patch(field: keyof CustomerRecord, value: string | null) { setEditing(previous => previous ? { ...previous, [field]: value } : null); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editing || busy) return;
    const submitted = editing;
    const record: CustomerRecord = {
      customer_key: submitted.customer_key, user_id: submitted.user_id, name: submitted.name.trim(),
      email: submitted.email.trim(), phone: submitted.phone, stage: submitted.stage,
      follow_up_on: submitted.follow_up_on, notes: submitted.notes, updated_at: new Date().toISOString(),
    };
    setBusy(true); setError(""); version.current++;
    try {
      if (!demo) {
        const { error } = await editorTask((db, signal) => db.from("customer_records").upsert(record).select("customer_key").abortSignal(signal).single());
        if (error) throw error;
      }
      if (!active.current) return;
      version.current++; setRecords(previous => [...previous.filter(row => row.customer_key !== record.customer_key), record]);
      setEditing(previous => previous === submitted ? null : previous);
      notice(demo ? t("Customer saved for this preview session.", "Đã lưu khách hàng cho phiên xem trước.") : t("Customer record saved.", "Đã lưu hồ sơ khách hàng."));
    } catch (error) { if (active.current) setError(customerError(error, language)); }
    finally { if (active.current) setBusy(false); }
  }
  return <div className="customer-manager">
    <div className="customer-metrics"><button className={!dueOnly ? "selected" : ""} onClick={() => setDueOnly(false)}><Users size={20}/><strong>{customers.length}</strong><span>{t("Customers & leads", "Khách hàng & khách tiềm năng")}</span></button><button className={dueOnly ? "selected" : ""} onClick={() => setDueOnly(!dueOnly)}><CalendarDays size={20}/><strong>{customers.filter(due).length}</strong><span>{t("Follow-ups due", "Cần liên hệ lại")}</span></button><button onClick={() => { setStage(stage === "tenant" ? "" : "tenant"); setDueOnly(false); }}><UserRound size={20}/><strong>{customers.filter(customer => customer.stage === "tenant").length}</strong><span>{t("Tenants", "Khách thuê")}</span></button></div>
    <div className="customer-toolbar"><div><h2>{t("People, well looked after.", "Chăm sóc từng khách hàng.")}</h2><p>{t("Customer accounts, guest enquiries and your own contacts, together.", "Tài khoản khách hàng, yêu cầu của khách và danh bạ riêng, tại một nơi.")}</p></div><div><button className="text-link" disabled={loading || busy || demo} onClick={() => void load()}><RefreshCw size={15} className={loading ? "spin" : ""}/>{t("Refresh", "Làm mới")}</button><button className="button button-small" onClick={addCustomer}><Plus size={16}/>{t("Add customer", "Thêm khách hàng")}</button></div></div>
    {demo && <div className="form-info">{t("Customer records in this preview are kept in memory for this visit. Live records require the connected customer portal.", "Hồ sơ xem trước chỉ được giữ trong bộ nhớ cho lượt truy cập này. Hồ sơ thực tế cần kết nối cổng khách hàng.")}</div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className={`customer-workspace ${editing ? "has-detail" : ""}`}><section className="admin-panel customer-directory">
      <div className="admin-table-tools"><label><Search size={17}/><input aria-label={t("Search customers", "Tìm khách hàng")} placeholder={t("Name, email or phone…", "Tên, email hoặc số điện thoại…")} value={query} onChange={e => setQuery(e.target.value)}/></label><SelectField aria-label={t("Customer stage", "Giai đoạn khách hàng")} value={stage} onValueChange={value => setStage(value)}><option value="">{t("All stages", "Mọi giai đoạn")}</option>{CUSTOMER_STAGES.map(value => <option key={value} value={value}>{stageLabel(value)}</option>)}</SelectField></div>
      {dueOnly && <div className="customer-filter-note">{t("Showing follow-ups due today or earlier.", "Hiển thị khách cần liên hệ hôm nay hoặc trước đó.")}<button className="text-link" onClick={() => setDueOnly(false)}>{t("Show all", "Hiện tất cả")}</button></div>}
      {filtered.length ? <div className="customer-rows">{filtered.map(customer => <button key={customer.customer_key} className={`customer-row ${editing?.customer_key === customer.customer_key ? "selected" : ""}`} onClick={() => { setEditing({ ...customer }); setError(""); }}><span className="avatar">{customer.name[0]?.toUpperCase() || "G"}</span><span><strong>{customer.name}</strong><small>{customer.email}</small><span className="customer-row-meta"><span className={`status-badge status-${customer.stage === "tenant" ? "published" : customer.stage === "closed" ? "closed" : "new"}`}>{stageLabel(customer.stage)}</span><span>{customer.enquiries.length} {t("enquiries", "yêu cầu")}</span>{customer.follow_up_on && <span className={due(customer) ? "followup-due" : ""}><CalendarDays size={12}/>{customer.follow_up_on}</span>}</span></span><ArrowUpRight size={16}/></button>)}</div> : <div className="admin-empty"><Users size={31}/><h3>{loading ? t("Loading your customers…", "Đang tải khách hàng…") : t("A good relationship starts here.", "Mối quan hệ tốt bắt đầu tại đây.")}</h3><p>{query || stage || dueOnly ? t("No customers match these filters.", "Không có khách hàng phù hợp bộ lọc.") : t("Customer profiles and enquiries appear here. You can also add a contact yourself.", "Hồ sơ và yêu cầu khách hàng sẽ xuất hiện tại đây. Bạn cũng có thể tự thêm liên hệ.")}</p></div>}
      <div className="table-footer">{filtered.length} {t("customers", "khách hàng")}</div>
    </section>
    {editing && <section className="admin-panel customer-detail" aria-label={t("Customer details", "Chi tiết khách hàng")}><div className="panel-heading"><div><div className="eyebrow">{editing.user_id ? t("CUSTOMER ACCOUNT", "TÀI KHOẢN KHÁCH HÀNG") : t("CUSTOMER RECORD", "HỒ SƠ KHÁCH HÀNG")}</div><h2>{editing.name || t("A new connection", "Một liên hệ mới")}</h2></div><button className="icon-button" disabled={busy} aria-label={t("Close customer details", "Đóng chi tiết khách hàng")} onClick={() => setEditing(null)}><X size={19}/></button></div>
      <form className="editor-form" onSubmit={save}><label>{t("Customer name", "Tên khách hàng")}<input value={editing.name} required minLength={2} maxLength={120} onChange={e => patch("name", e.target.value)}/></label><label>{t("Contact email", "Email liên hệ")}<input value={editing.email} type="email" required maxLength={254} onChange={e => patch("email", e.target.value)}/></label><label>{t("Phone number", "Số điện thoại")}<input value={editing.phone} type="tel" maxLength={40} onChange={e => patch("phone", e.target.value)}/></label>
      <div className="customer-contact-links"><a href={`mailto:${editing.email}`}><Mail size={14}/>{t("Email", "Gửi email")}</a>{editing.phone && <a href={`tel:${editing.phone}`}><Phone size={14}/>{t("Call", "Gọi điện")}</a>}</div>
      <div className="form-row"><label>{t("Stage", "Giai đoạn")}<SelectField value={editing.stage} onValueChange={value => patch("stage", value)}>{CUSTOMER_STAGES.map(value => <option value={value} key={value}>{stageLabel(value)}</option>)}</SelectField></label><label>{t("Next follow-up", "Ngày liên hệ lại")}<input type="date" value={editing.follow_up_on ?? ""} onChange={e => patch("follow_up_on", e.target.value || null)}/></label></div>
      <label>{t("Internal notes", "Ghi chú nội bộ")}<textarea value={editing.notes} rows={5} maxLength={8000} onChange={e => patch("notes", e.target.value)} placeholder={t("Preferences, next steps, a note for the team…", "Nhu cầu, bước tiếp theo, ghi chú cho đội ngũ…")}/><small>{t("Only the team can see these notes and follow-up dates.", "Chỉ đội ngũ có thể xem ghi chú và ngày liên hệ lại.")}</small></label>
      {editing.profile && <div className="customer-preferences"><h3>{t("From their profile", "Từ hồ sơ khách hàng")}</h3>{editing.profile.preferred_district && <p><strong>{t("Neighbourhood:", "Khu vực:")}</strong> {content.neighbourhoods.find(n => n.slug === editing.profile?.preferred_district)?.name ?? editing.profile.preferred_district}</p>}{(editing.profile.budget_min !== null || editing.profile.budget_max !== null) && <p><strong>{t("Monthly budget:", "Ngân sách tháng:")}</strong> ${editing.profile.budget_min ?? "…"} – ${editing.profile.budget_max ?? "…"}</p>}{editing.profile.move_in_date && <p><strong>{t("Move-in:", "Chuyển vào:")}</strong> {editing.profile.move_in_date}</p>}{editing.profile.preferences && <p className="customer-preference-text">{editing.profile.preferences}</p>}</div>}
      {editing.enquiries.length > 0 && <div className="customer-history"><h3>{t("Their conversations", "Lịch sử trao đổi")}</h3>{editing.enquiries.map(enquiry => <button type="button" key={enquiry.id} onClick={() => openEnquiry({ ...enquiry })}><MessageSquare size={15}/><span><strong>{enquiryLabel(enquiry, language)}</strong><small>{enquiry.message.slice(0, 100)}</small></span><ArrowUpRight size={14}/></button>)}</div>}
      <button className="button" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>} {t("Save customer", "Lưu khách hàng")}</button>
      </form></section>}
    </div>
  </div>;
}
