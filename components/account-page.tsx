"use client";
import { SelectField } from "./select-field";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { ArrowRight, ArrowUpRight, CalendarDays, Check, Heart, LayoutDashboard, LoaderCircle, LogOut, MessageSquare, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { SubmissionHistory } from "./submission-history";
import { useSite } from "./site-context";
import { AnimatedBackground } from "./motion-primitives/animated-background";
import { NumberTicker } from "./magicui/number-ticker";
import { PortalSwitcher } from "./portal-access";
import { PropertyCard } from "./property-card";
import { request } from "@/lib/requests";
import { appointmentLabel, customerError, ENQUIRY_FIELDS, enquiryLabel } from "@/lib/customer-data";
import type { CustomerEnquiry, CustomerProfile } from "@/lib/types";

type AccountTab = "overview" | "saved" | "enquiries" | "viewings" | "profile" | "submissions";
type Draft = { userId: string; value: CustomerProfile } | null;

export function AccountPage() {
  const { user } = useSite();
  // Memory only. A same-account reauthentication can recover the draft, while
  // another identity never receives it. Explicit sign-out clears it below.
  const [draft, setDraft] = useState<Draft>(null);
  return user
    ? <CustomerWorkspace key={user.id} user={user} draft={draft?.userId === user.id ? draft.value : null}
        setDraft={next => setDraft(previous => {
          const value = typeof next === "function" ? next(previous?.userId === user.id ? previous.value : null) : next;
          return value ? { userId: user.id, value } : null;
        })} clearDraft={() => setDraft(null)}/>
    : <CustomerAuth/>;
}

function CustomerAuth() {
  const { t, client, ready, configured, reconnect, content, language } = useSite();
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const confirmPassword = useRef<HTMLInputElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!client || busy) return;
    const form = new FormData(event.currentTarget), email = String(form.get("email")).trim(), password = String(form.get("password") ?? "");
    setError(""); setMessage("");
    if (mode === "signup" && password !== String(form.get("confirm_password") ?? "")) {
      setError(t("The passwords don’t match.", "Mật khẩu không khớp."));
      confirmPassword.current?.focus();
      return;
    }
    setBusy(true);
    try {
      if (mode === "reset") {
        const { error } = await request(() => client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + "/auth/reset" }));
        if (error) throw error;
        setMessage(t("If an account exists, a password reset link has been requested. Check your inbox.", "Nếu tài khoản tồn tại, liên kết đặt lại mật khẩu sẽ được gửi. Hãy kiểm tra hộp thư."));
      } else if (mode === "signup") {
        const { data, error } = await request(() => client.auth.signUp({
          email, password,
          options: { data: { full_name: String(form.get("full_name")).trim() }, emailRedirectTo: window.location.origin + "/account" },
        }));
        if (error) throw error;
        if (data.session) await reconnect();
        else setMessage(t("Check your inbox to confirm your email, then return here to sign in. If you already have an account, use Sign in.", "Hãy kiểm tra hộp thư để xác nhận email, sau đó quay lại đăng nhập. Nếu đã có tài khoản, hãy chọn Đăng nhập."));
      } else {
        const { error } = await request(() => client.auth.signInWithPassword({ email, password: String(form.get("password")) }));
        if (error) throw error;
        await reconnect();
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      setError(/invalid login/i.test(detail) ? t("That email and password don’t match. Please try again.", "Email và mật khẩu chưa khớp. Vui lòng thử lại.")
        : /email not confirmed/i.test(detail) ? t("Confirm your email using the link in your inbox before signing in.", "Hãy xác nhận email qua liên kết trong hộp thư trước khi đăng nhập.")
        : customerError(error, language));
    } finally { setBusy(false); }
  }
  function changeMode(next: typeof mode) { setMode(next); setError(""); setMessage(""); }
  return <section className="container account-entry">
    <PortalSwitcher active="customer"/>
    <div className="account-welcome"><div className="eyebrow">{t("CUSTOMER PORTAL", "CỔNG KHÁCH HÀNG")}</div><h1>{t("Your home search,", "Hành trình tìm nhà,")}<br/><em>{t("all in one place.", "ngay tại một nơi.")}</em></h1>
      <p>{t("For customers looking for a home. Use your personal email to save a shortlist, follow viewing requests and keep in touch with the team.", "Dành cho khách hàng tìm nhà. Dùng email cá nhân để lưu nhà yêu thích, theo dõi yêu cầu xem nhà và trao đổi cùng đội ngũ.")}</p>
      <div className="account-benefits"><span><Heart size={19}/>{t("Your shortlist, on every device", "Nhà đã lưu trên mọi thiết bị")}</span><span><CalendarDays size={19}/>{t("Viewing requests and confirmed times", "Yêu cầu xem nhà và lịch đã xác nhận")}</span><span><MessageSquare size={19}/>{t("Conversations with the Gary team", "Trao đổi cùng đội ngũ Gary")}</span></div>
      <div className="account-welcome-photo"><img src="/images/apartments/hero.jpg" width="640" height="300" loading="lazy" alt={t("A welcoming home in Hanoi", "Một tổ ấm tại Hà Nội")}/><span>{t("A place to begin again.", "Nơi bắt đầu chương mới.")}</span></div>
    </div>
    <div className="account-auth-card"><span className="account-auth-icon"><UserRound size={25}/></span><div className="eyebrow">{t("PERSONAL ACCOUNT", "TÀI KHOẢN CÁ NHÂN")}</div>
      <h2>{mode === "signup" ? t("Create a customer account.", "Tạo tài khoản khách hàng.") : mode === "reset" ? t("Reset customer password.", "Đặt lại mật khẩu khách hàng.") : t("Customer sign in.", "Khách hàng đăng nhập.")}</h2>
      <p>{mode === "signup" ? t("Create your customer account. It only takes a moment.", "Tạo tài khoản khách hàng chỉ trong giây lát.") : mode === "reset" ? t("We’ll send a link to reset your password.", "Chúng tôi sẽ gửi liên kết đặt lại mật khẩu.") : t("Sign in to pick up where you left off.", "Đăng nhập để tiếp tục hành trình tìm nhà.")}</p>
      {!configured ? <div className="form-info">{t("Customer accounts are not connected yet. You can still browse homes and contact the team.", "Tài khoản khách hàng chưa được kết nối. Bạn vẫn có thể tìm nhà và liên hệ đội ngũ.")}<Link className="text-link" href="/contact">{t("Contact the team", "Liên hệ đội ngũ")}<ArrowRight size={15}/></Link></div>
        : <form className="enquiry-form" aria-label={t("Customer account access", "Truy cập tài khoản khách hàng")} onSubmit={submit}>
          {mode === "signup" && <label>{t("Your name", "Họ và tên")}<input name="full_name" required minLength={2} maxLength={120} autoComplete="name"/></label>}
          <label>{t("Personal email address", "Địa chỉ email cá nhân")}<input name="email" type="email" required maxLength={254} autoComplete="email"/></label>
          {mode !== "reset" && <label>{t("Password", "Mật khẩu")}<input name="password" type="password" required minLength={mode === "signup" ? 12 : undefined} autoComplete={mode === "signup" ? "new-password" : "current-password"}/>{mode === "signup" && <small>{t("Use at least 12 characters.", "Sử dụng ít nhất 12 ký tự.")}</small>}</label>}
          {mode === "signup" && <label>{t("Confirm password", "Xác nhận mật khẩu")}<input ref={confirmPassword} name="confirm_password" type="password" required minLength={12} autoComplete="new-password"/></label>}
          {mode === "signup" && <label className="consent-label"><input name="consent" type="checkbox" required/><span>{t("I agree to the", "Tôi đồng ý với")} <Link href="/privacy" target="_blank">{t("privacy policy", "chính sách bảo mật")}</Link>.</span></label>}
          {message && <div className="form-info" role="status"><Check size={17}/>{message}</div>}
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button" disabled={busy || !ready || !client}>{busy ? <LoaderCircle className="spin" size={17}/> : <ArrowRight size={17}/>} {mode === "signup" ? t("Create account", "Tạo tài khoản") : mode === "reset" ? t("Send reset link", "Gửi liên kết") : t("Sign in", "Đăng nhập")}</button>
          {!ready ? <p role="status">{t("Connecting securely…", "Đang kết nối an toàn…")}</p> : !client && <button className="text-link" type="button" onClick={() => void reconnect()}>{t("Reconnect", "Kết nối lại")}</button>}
          <div className="account-auth-options">{mode === "signin" ? <><button type="button" onClick={() => changeMode("signup")}>{t("Create an account", "Tạo tài khoản")}</button><button type="button" onClick={() => changeMode("reset")}>{t("Forgot password?", "Quên mật khẩu?")}</button></> : <button type="button" onClick={() => changeMode("signin")}>{t("Back to sign in", "Quay lại đăng nhập")}</button>}</div>
        </form>}
      <div className="account-help"><ShieldCheck size={16}/><p>{t("Your account is personal. Your details are shared only with the Gary Home team.", "Tài khoản dành riêng cho bạn. Thông tin chỉ được chia sẻ với đội ngũ Gary Home.")}</p></div>
      <a className="text-link" href={`mailto:${content.settings.contact_email}`}>{t("Need a hand? We’re here.", "Cần hỗ trợ? Chúng tôi luôn ở đây.")}<ArrowUpRight size={15}/></a>
      <Link className="account-team-link portal-other-link" href="/admin"><ShieldCheck size={19}/><span><strong>{t("Are you a staff member?", "Bạn là nhân viên Gary Home?")}</strong><small>{t("Use staff login with your assigned company account", "Đăng nhập nhân viên bằng tài khoản công ty được cấp")}</small></span><ArrowUpRight size={17}/></Link>
    </div>
  </section>;
}

function CustomerWorkspace({ user, draft, setDraft, clearDraft }: {
  user: User; draft: CustomerProfile | null;
  setDraft: (next: CustomerProfile | null | ((previous: CustomerProfile | null) => CustomerProfile | null)) => void;
  clearDraft: () => void;
}) {
  const { t, content, language, client, staffProfile, user: currentUser, editor, sessionPhase, accountTask, reconnect, saved, savedReady, savedError, importSaved, notice } = useSite();
  const [tab, setTab] = useState<AccountTab>("overview"), [enquiries, setEnquiries] = useState<CustomerEnquiry[]>([]);
  const [profile, setProfile] = useState<CustomerProfile | null>(null), [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState("");
  const sequence = useRef(0), version = useRef(0), active = useRef(true);
  const refreshFlight = useRef(false);
  const identity = useRef(currentUser?.id), locale = useRef(language);
  useEffect(() => { identity.current = currentUser?.id; locale.current = language; }, [currentUser?.id, language]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const load = useCallback(async () => {
    if (!client || identity.current !== user.id) return;
    const read = ++sequence.current, startedVersion = version.current;
    setLoading(true);
    try {
      const [p, e] = await request(signal => Promise.all([
        client.from("customer_profiles").select("*").eq("user_id", user.id).abortSignal(signal).maybeSingle(),
        client.from("enquiries").select(ENQUIRY_FIELDS).eq("user_id", user.id).order("created_at", { ascending: false }).abortSignal(signal),
      ]));
      if (!active.current || identity.current !== user.id || read !== sequence.current || version.current !== startedVersion) return;
      if (p.error || e.error) throw p.error || e.error;
      setProfile(p.data as CustomerProfile | null); setEnquiries((e.data ?? []) as CustomerEnquiry[]); setLoaded(true); setNow(Date.now()); setError("");
    } catch (error) { if (active.current && read === sequence.current && identity.current === user.id) setError(customerError(error, locale.current)); }
    finally { if (active.current && read === sequence.current) setLoading(false); }
  }, [client, user.id]);
  async function refreshAccount() {
    if (refreshFlight.current) return;
    refreshFlight.current = true; setLoading(true);
    try {
      await reconnect();
      // A fast recovery may finish in the same React update and leave the phase
      // unchanged. Explicitly re-read customer data after a manual refresh.
      await load();
    } catch (error) {
      if (active.current && identity.current === user.id) setError(customerError(error, locale.current));
    } finally {
      refreshFlight.current = false;
      if (active.current && identity.current === user.id) setLoading(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    if (sessionPhase === "ready") queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; };
  }, [sessionPhase, load]);
  const defaultProfile: CustomerProfile = {
    user_id: user.id, full_name: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "",
    email: user.email ?? "", phone: "", preferred_district: null, budget_min: null, budget_max: null,
    move_in_date: null, preferences: "", updated_at: "",
  };
  const details = draft ?? profile ?? defaultProfile;
  function patch(field: keyof CustomerProfile, value: string | number | null) { setDraft({ ...details, [field]: value }); }
  async function saveProfile(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    const submitted = details;
    if (submitted.full_name.trim().length < 2) { setError(t("Please enter your full name.", "Vui lòng nhập họ và tên.")); return; }
    if (submitted.budget_min !== null && submitted.budget_max !== null && submitted.budget_min > submitted.budget_max) { setError(t("Your minimum budget must be below your maximum.", "Ngân sách tối thiểu phải nhỏ hơn ngân sách tối đa.")); return; }
    setBusy("profile"); setError(""); version.current++;
    try {
      const { data, error } = await accountTask((db, signal, userId) => db.from("customer_profiles").upsert({ ...submitted, full_name: submitted.full_name.trim(), user_id: userId, email: user.email, updated_at: new Date().toISOString() }).select("*").abortSignal(signal).single());
      if (error) throw error;
      if (!active.current) return;
      version.current++; setProfile(data as CustomerProfile);
      setDraft(previous => previous === submitted ? null : previous);
      notice(t("Your details have been saved.", "Đã lưu thông tin của bạn."));
    } catch (error) { if (active.current) setError(customerError(error, language)); }
    finally { if (active.current) setBusy(""); }
  }
  async function cancelViewing(id: string) {
    if (busy) return;
    setBusy(id); setError(""); version.current++;
    try {
      const { data, error } = await accountTask((db, signal, userId) => db.from("enquiries").update({ cancelled_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId).is("cancelled_at", null).select(ENQUIRY_FIELDS).abortSignal(signal).single());
      if (error) throw error;
      if (!active.current) return;
      version.current++; setEnquiries(previous => previous.map(row => row.id === id ? data as CustomerEnquiry : row));
      notice(t("Your viewing request has been cancelled.", "Đã hủy yêu cầu xem nhà."));
    } catch (error) { if (active.current) setError(customerError(error, language)); }
    finally { if (active.current) setBusy(""); }
  }
  async function signOut() {
    if (!client || busy) return;
    setBusy("signout"); setError("");
    try { const { error } = await request(() => client.auth.signOut()); if (error) throw error; clearDraft(); }
    catch (error) { if (active.current) { setError(customerError(error, language)); setBusy(""); } }
  }
  async function importShortlist() {
    setBusy("import"); setError("");
    try { const count = await importSaved(); if (active.current) notice(count ? t("Your browser shortlist is now saved to your account.", "Đã thêm danh sách trên trình duyệt vào tài khoản.") : t("No published homes to import from this browser.", "Trình duyệt chưa có nhà đang đăng để nhập.")); }
    catch (error) { if (active.current) setError(customerError(error, language)); }
    finally { if (active.current) setBusy(""); }
  }
  const tabs: [AccountTab, string, typeof Heart][] = [["overview", t("Overview", "Tổng quan"), LayoutDashboard], ["saved", t("Saved homes", "Nhà đã lưu"), Heart], ["enquiries", t("My enquiries", "Yêu cầu của tôi"), MessageSquare], ["viewings", t("My viewings", "Lịch xem nhà"), CalendarDays], ["profile", t("My details", "Thông tin của tôi"), UserRound], ["submissions", t("Feedback & help", "Phản hồi & hỗ trợ"), MessageSquare]];
  const savedHomes = content.properties.filter(p => saved.includes(p.id) && p.status === "published");
  const viewings = enquiries.filter(e => e.kind === "viewing");
  const upcoming = viewings.filter(e => !e.cancelled_at && e.status !== "closed" && (!e.appointment_at || new Date(e.appointment_at).getTime() > now));
  const firstName = (profile?.full_name || defaultProfile.full_name).split(" ")[0];
  return <section className="container account-page">
    <PortalSwitcher active="customer"/>
    <div className="account-heading"><div><div className="eyebrow">{t("CUSTOMER PORTAL", "CỔNG KHÁCH HÀNG")}</div><h1>{firstName ? t(`Hello, ${firstName}.`, `Xin chào, ${firstName}.`) : t("A little closer to home.", "Gần hơn với tổ ấm.")}</h1><p>{t("Your saved homes, enquiries and viewing plans.", "Nhà đã lưu, yêu cầu và kế hoạch xem nhà của bạn.")}</p></div><Link href="/homes" className="button button-outline">{t("Keep exploring", "Tiếp tục tìm nhà")}<ArrowUpRight size={17}/></Link></div>
    <div className="account-layout"><aside className="account-sidebar"><div className="account-person"><span className="avatar">{staffProfile?.avatar_path&&client?<img className="account-staff-avatar" src={client.storage.from("staff-avatars").getPublicUrl(staffProfile.avatar_path).data.publicUrl} alt=""/>:(firstName||user.email||"G")[0].toUpperCase()}</span><div><strong>{profile?.full_name || defaultProfile.full_name || t("Your account", "Tài khoản của bạn")}</strong><small>{user.email}</small></div></div>
      <nav aria-label={t("Customer account", "Tài khoản khách hàng")}><AnimatedBackground activeValue={tab}>{tabs.map(([id, label, Icon]) => <button key={id} data-id={id} className={tab === id ? "selected" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}><Icon size={18}/>{label}{id === "saved" && savedReady && <span>{saved.length}</span>}</button>)}</AnimatedBackground></nav>
      <div className="account-sidebar-bottom">{editor && <Link href="/admin"><ShieldCheck size={16}/>{t("Open staff Studio", "Mở Studio nhân viên")}<ArrowUpRight size={14}/></Link>}<button onClick={() => void signOut()} disabled={!!busy}><LogOut size={16}/>{t("Sign out", "Đăng xuất")}</button></div>
    </aside><div className="account-main">
      <div className="account-section-heading"><div><div className="eyebrow">{t("A SPACE OF YOUR OWN", "KHÔNG GIAN RIÊNG CỦA BẠN")}</div><h2>{tabs.find(([id]) => id === tab)?.[1]}</h2></div><button className="text-link" disabled={loading || !!busy} onClick={() => void refreshAccount()}><RefreshCw size={15} className={loading ? "spin" : ""}/>{t("Refresh", "Làm mới")}</button></div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {savedError && tab === "saved" && <div className="form-error" role="alert">{savedError}</div>}
      {tab === "submissions" && <SubmissionHistory/>}
      {tab === "saved" && <div className="account-import"><p>{t("Saved homes before signing in on this browser? Bring them with you.", "Bạn đã lưu nhà trên trình duyệt trước khi đăng nhập? Hãy thêm vào tài khoản.")}</p><button type="button" className="text-link" disabled={!!busy || !savedReady} onClick={() => void importShortlist()}>{busy === "import" ? t("Importing…", "Đang nhập…") : t("Import browser shortlist", "Nhập danh sách trên trình duyệt")}<ArrowRight size={15}/></button></div>}
      {!loaded && loading && <div className="account-loading" role="status"><LoaderCircle size={20} className="spin"/>{t("Bringing your plans together…", "Đang tải kế hoạch của bạn…")}</div>}
      {tab === "overview" && <>
        <div className="account-stats">{[[Heart, savedReady ? saved.length : "—", t("Homes you love", "Nhà bạn yêu thích"), "saved"], [CalendarDays, loaded ? upcoming.length : "—", t("Viewing plans", "Kế hoạch xem nhà"), "viewings"], [MessageSquare, loaded ? enquiries.length : "—", t("Conversations", "Cuộc trao đổi"), "enquiries"]].map(([Icon, count, label, target]) => { const Symbol = Icon as typeof Heart; return <button key={String(target)} onClick={() => setTab(target as AccountTab)}><Symbol size={21}/><strong>{typeof count === "number" ? <NumberTicker value={count}/> : String(count)}</strong><span>{String(label)}<ArrowUpRight size={15}/></span></button>; })}</div>
        <div className="account-plan-card"><div><div className="eyebrow">{t("YOUR NEXT MOVE", "BƯỚC TIẾP THEO")}</div><h3>{t("A viewing is a good beginning.", "Một buổi xem nhà, một khởi đầu tốt.")}</h3><p>{t("Find a place that feels right, request a date, and we’ll arrange the details with you.", "Chọn ngôi nhà phù hợp, gửi ngày bạn muốn xem và chúng tôi sẽ cùng bạn sắp xếp chi tiết.")}</p><Link className="text-link" href="/homes">{t("Find a home to visit", "Tìm nhà để ghé thăm")}<ArrowRight size={16}/></Link></div><CalendarDays size={66} strokeWidth={1}/></div>
        {upcoming.length > 0 && <div className="account-preview"><h3>{t("On your horizon", "Kế hoạch sắp tới")}</h3><EnquiryCards rows={upcoming.slice(0, 2)} busy={busy} cancel={cancelViewing}/></div>}
        {!profile && loaded && <div className="account-profile-nudge"><UserRound size={22}/><div><strong>{t("Tell us a little about your plans.", "Chia sẻ thêm về kế hoạch của bạn.")}</strong><p>{t("A budget, a neighbourhood, a move-in date. We’ll help you find the right fit.", "Ngân sách, khu vực, ngày chuyển vào. Chúng tôi sẽ giúp bạn tìm ngôi nhà phù hợp.")}</p></div><button className="text-link" onClick={() => setTab("profile")}>{t("Add my details", "Thêm thông tin")}<ArrowRight size={15}/></button></div>}
      </>}
      {tab === "saved" && <>{!savedReady && !savedError ? <p role="status">{t("Connecting your saved homes…", "Đang kết nối danh sách nhà đã lưu…")}</p> : savedHomes.length ? <div className="property-grid account-property-grid">{savedHomes.map(p => <PropertyCard key={p.id} property={p}/>)}</div> : savedReady && <EmptyAccount icon={Heart} title={t("Keep a little shortlist.", "Lưu lại những ngôi nhà ưng ý.")} text={t("Tap the heart on any home to save it to your account, on every device.", "Nhấn biểu tượng trái tim để lưu nhà vào tài khoản trên mọi thiết bị.")}/>}<p className="account-fineprint">{t("Only currently published homes appear here. Availability is confirmed by the team.", "Chỉ những nhà đang được đăng mới hiển thị. Vui lòng xác nhận tình trạng với đội ngũ.")}</p></>}
      {(tab === "enquiries" || tab === "viewings") && <><div className="account-list-intro"><p>{tab === "viewings" ? t("Requested dates are confirmed once the team agrees a time with you. All confirmed times are shown in Hanoi time (GMT+7).", "Ngày yêu cầu được xác nhận sau khi đội ngũ thống nhất với bạn. Mọi lịch đã xác nhận đều theo giờ Hà Nội (GMT+7).") : t("Follow your requests and the team’s updates here. Earlier requests sent while signed out stay private and are not linked automatically.", "Theo dõi yêu cầu và cập nhật từ đội ngũ tại đây. Yêu cầu trước khi đăng nhập được giữ riêng và không tự động liên kết.")}</p><Link className="text-link" href={tab === "viewings" ? "/homes" : "/contact"}>{tab === "viewings" ? t("Request a viewing", "Đặt lịch xem nhà") : t("Send a message", "Gửi lời nhắn")}<ArrowUpRight size={15}/></Link></div>{loaded && (tab === "viewings" ? viewings : enquiries).length === 0 ? <EmptyAccount icon={tab === "viewings" ? CalendarDays : MessageSquare} title={t("Your next conversation starts here.", "Cuộc trao đổi tiếp theo bắt đầu tại đây.")} text={t("Send a request while signed in and you’ll find it here.", "Gửi yêu cầu khi đã đăng nhập và bạn sẽ thấy tại đây.")}/> : <EnquiryCards rows={tab === "viewings" ? viewings : enquiries} busy={busy} cancel={cancelViewing}/>}</>}
      {tab === "profile" && <form className="enquiry-form account-details-form" onSubmit={saveProfile}>
        <p>{t("A few details help the team find a home that feels like you.", "Một vài thông tin giúp đội ngũ tìm ngôi nhà phù hợp với bạn.")}</p>
        <div className="form-row"><label>{t("Full name", "Họ và tên")}<input value={details.full_name} required minLength={2} maxLength={120} autoComplete="name" onChange={e => patch("full_name", e.target.value)}/></label><label>{t("Phone number", "Số điện thoại")}<input type="tel" value={details.phone} maxLength={40} autoComplete="tel" onChange={e => patch("phone", e.target.value)}/></label></div>
        <label>{t("Account email", "Email tài khoản")}<input type="email" value={user.email ?? ""} readOnly/><small>{t("Contact the team if you need help changing your account email.", "Liên hệ đội ngũ nếu bạn cần hỗ trợ đổi email tài khoản.")}</small></label>
        <div className="form-row"><label>{t("Preferred neighbourhood", "Khu vực mong muốn")}<SelectField value={details.preferred_district ?? ""} onValueChange={value => patch("preferred_district", value || null)}><option value="">{t("Open to possibilities", "Sẵn sàng khám phá")}</option>{content.neighbourhoods.map(n => <option key={n.slug} value={n.slug}>{n.name}</option>)}</SelectField></label><label>{t("Move-in date", "Ngày chuyển vào")}<input type="date" value={details.move_in_date ?? ""} onChange={e => patch("move_in_date", e.target.value || null)}/></label></div>
        <div className="form-row"><label>{t("Minimum budget · USD / month", "Ngân sách tối thiểu · USD / tháng")}<input type="number" min="0" step="1" value={details.budget_min ?? ""} onChange={e => patch("budget_min", e.target.value === "" ? null : Number(e.target.value))}/></label><label>{t("Maximum budget · USD / month", "Ngân sách tối đa · USD / tháng")}<input type="number" min="0" step="1" value={details.budget_max ?? ""} onChange={e => patch("budget_max", e.target.value === "" ? null : Number(e.target.value))}/></label></div>
        <label>{t("What makes a place feel like home?", "Điều gì tạo nên tổ ấm của bạn?")}<textarea value={details.preferences} maxLength={2000} rows={5} placeholder={t("Pets, a quiet workspace, room for a family…", "Thú cưng, góc làm việc yên tĩnh, không gian cho gia đình…")} onChange={e => patch("preferences", e.target.value)}/></label>
        <div className="account-form-footer"><span>{draft ? t("You have unsaved changes.", "Bạn có thay đổi chưa lưu.") : t("Only you and the team can see these details.", "Chỉ bạn và đội ngũ có thể xem thông tin này.")}</span><button className="button" disabled={!!busy || !loaded}>{busy === "profile" ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>} {t("Save my details", "Lưu thông tin")}</button></div>
      </form>}
      <div className="account-concierge"><div><strong>{t("A real person, a message away.", "Một người thật, luôn sẵn sàng hỗ trợ.")}</strong><span>{t("Questions about a home or your next move? We’re here.", "Có câu hỏi về ngôi nhà hay kế hoạch chuyển vào? Chúng tôi luôn ở đây.")}</span></div><Link href="/contact" className="text-link">{t("Talk to the team", "Trao đổi cùng đội ngũ")}<ArrowUpRight size={16}/></Link></div>
    </div></div>
  </section>;
}

function EnquiryCards({ rows, busy, cancel }: { rows: CustomerEnquiry[]; busy: string; cancel: (id: string) => Promise<void> }) {
  const { t, language, content } = useSite();
  return <div className="account-enquiry-list">{rows.map(enquiry => {
    const property = content.properties.find(p => p.id === enquiry.property_id && p.status === "published");
    const title = property ? (language === "vi" ? property.title_vi || property.title_en : property.title_en) : enquiry.kind === "viewing" ? t("Your viewing request", "Yêu cầu xem nhà của bạn") : t("Your conversation with Gary", "Cuộc trao đổi với Gary");
    return <article className="account-enquiry" key={enquiry.id}><div className="account-enquiry-top"><div><span className="eyebrow">{enquiry.kind === "viewing" ? t("A PLACE TO VISIT", "NGÔI NHÀ MUỐN GHÉ THĂM") : t("LET’S TALK", "CÙNG TRÒ CHUYỆN")}</span><h3>{property ? <Link href={`/homes/${property.slug}`}>{title}<ArrowUpRight size={16}/></Link> : title}</h3></div><span className={`status-badge ${enquiry.cancelled_at ? "status-closed" : enquiry.status === "scheduled" && enquiry.appointment_at ? "status-published" : "status-new"}`}>{enquiryLabel(enquiry, language)}</span></div>
      {enquiry.status === "scheduled" && enquiry.appointment_at && !enquiry.cancelled_at ? <div className="account-appointment"><CalendarDays size={18}/><strong>{appointmentLabel(enquiry.appointment_at, language)}</strong><span>{t("Hanoi time · GMT+7", "Giờ Hà Nội · GMT+7")}</span></div> : enquiry.preferred_date && <p className="account-request-date"><CalendarDays size={16}/>{t("Requested date:", "Ngày muốn xem:")} {new Date(enquiry.preferred_date + "T12:00:00").toLocaleDateString(language === "vi" ? "vi-VN" : "en-GB")}</p>}
      <p className="account-enquiry-message">{enquiry.message}</p>
      {enquiry.customer_update && <div className="account-team-update"><strong>{t("From the Gary team", "Từ đội ngũ Gary")}</strong><p>{enquiry.customer_update}</p></div>}
      <div className="account-enquiry-bottom"><time dateTime={enquiry.created_at}>{t("Sent", "Đã gửi")} {new Date(enquiry.created_at).toLocaleDateString(language === "vi" ? "vi-VN" : "en-GB")}</time>{enquiry.kind === "viewing" && enquiry.status !== "closed" && !enquiry.cancelled_at && <button className="text-link" disabled={!!busy} onClick={() => void cancel(enquiry.id)}>{busy === enquiry.id ? t("Cancelling…", "Đang hủy…") : t("Cancel viewing request", "Hủy yêu cầu xem nhà")}</button>}</div>
    </article>;
  })}</div>;
}

function EmptyAccount({ icon: Icon, title, text }: { icon: typeof Heart; title: string; text: string }) {
  const { t } = useSite();
  return <div className="account-empty"><span><Icon size={28} strokeWidth={1.5}/></span><h3>{title}</h3><p>{text}</p><Link href="/homes" className="button button-outline">{t("Explore homes", "Khám phá nhà")}<ArrowRight size={16}/></Link></div>;
}
