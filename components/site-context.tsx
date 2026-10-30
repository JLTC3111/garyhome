"use client";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { emailLinkIssue, emailTokenLink, passwordLinkEvidence, type PasswordLink, type EmailLinkIssue, type EmailTokenLink } from "@/lib/password-actions";
import type { Content, Enquiry, ExchangeRate, Language, PriceCurrency } from "@/lib/types";
import { languageValue, persistLanguage } from "@/lib/language";
import { CURRENCY_COOKIE, currencyValue, persistCurrency, usableExchangeRate } from "@/lib/currency";
import { studioText } from "@/lib/studio-i18n";
import { browserClient, publicBrowserClient } from "@/lib/browser-client";
import { readPublishedContent } from "@/lib/public-content";
import { installRecoveryEvents } from "@/lib/recovery-events";
import { fetchWithDeadline, request } from "@/lib/requests";
import { SessionRecovery, type SessionPhase, type SessionState } from "@/lib/session-recovery";
import { customerError, ENQUIRY_FIELDS } from "@/lib/customer-data";
import { contentAssets } from "@/lib/content-assets";
import { propertyOrders } from "@/lib/property-order";
import { readBrowserFavourites,claimBrowserFavourites,acknowledgeBrowserFavourites,releaseBrowserFavouriteClaim } from "@/lib/favourites";
import { isPublicRental } from "@/lib/rentals";
import type { StaffRole,StaffProfile } from "@/lib/staff";

type Update<T> = T | ((previous: T) => T);
type SiteContext = {
  content: Content; setContent: (content: Update<Content>) => void;
  language: Language; setLanguage: (l: Language) => void; t: (en: string, vi: string) => string;
  currency: PriceCurrency; setCurrency: (currency: PriceCurrency) => void; exchangeRate: ExchangeRate | null;
  saved: string[]; toggleSaved: (id: string) => void;
  savedReady: boolean; savedError: string; pendingSaved: string[];
  importSaved: () => Promise<number>;
  compare: string[]; toggleCompare: (id: string) => void;
  configured: boolean; backendError: boolean; client: SupabaseClient | null; publicClient:SupabaseClient|null; ready: boolean;
  user: User | null; editor: boolean; staffRole: StaffRole | null; demo: boolean; enterDemo: () => void; exitDemo: () => void;
  staffProfile:StaffProfile|null;refreshStaffProfile:()=>Promise<void>;
  passwordLink:PasswordLink|null;
  passwordLinkIssue:EmailLinkIssue|null;
  emailVerification:{type:PasswordLink["type"];busy:boolean;failed:boolean}|null;
  verifyEmailLink:()=>Promise<void>;
  sessionPhase: SessionPhase; reconnect: () => Promise<void>;
  editorTask: <T>(operation: (db: SupabaseClient, signal: AbortSignal) => PromiseLike<T>) => Promise<T>;
  accountTask: <T>(operation: (db: SupabaseClient, signal: AbortSignal, userId: string) => PromiseLike<T>) => Promise<T>;
  enquiries: Enquiry[]; setEnquiries: (list: Update<Enquiry[]>) => void; refresh: () => Promise<void>;
  notice: (message: string) => void;
};
const Context = createContext<SiteContext | null>(null);
export function SiteProvider({ children, initial, initialLanguage = "en", initialCurrency = "USD" }: { children: ReactNode; initialLanguage?: Language; initialCurrency?: PriceCurrency; initial: { content: Content; configured: boolean; error: boolean; exchangeRate?: ExchangeRate | null } }) {
  const router=useRouter(),routerRef=useRef(router);
  useEffect(()=>{routerRef.current=router;},[router]);
  const [passwordLink,setPasswordLink]=useState<PasswordLink|null>(null);
  const [staffProfile,setStaffProfile]=useState<StaffProfile|null>(null);
  const [passwordLinkIssue,setPasswordLinkIssue]=useState<EmailLinkIssue|null>(null);
  const [emailVerification,setEmailVerification]=useState<{type:PasswordLink["type"];busy:boolean;failed:boolean}|null>(null);
  const pendingEmail=useRef<EmailTokenLink|null>(null),verificationFlight=useRef(false);
  const [content, updateContent] = useState(initial.content);
  const [backendError, setBackendError] = useState(initial.error);
  const [contentRecovering, setContentRecovering] = useState(false);
  const [language, updateLanguage] = useState<Language>(initialLanguage);
  const [currency, updateCurrency] = useState<PriceCurrency>(initialCurrency);
  const [exchangeRate, updateExchangeRate] = useState<ExchangeRate | null>(initial.exchangeRate ?? null);
  const setCurrency = useCallback((value: PriceCurrency) => { updateCurrency(value); persistCurrency(value); }, []);
  useLayoutEffect(() => {
    let selected = initialCurrency;
    try { const stored = localStorage.getItem(CURRENCY_COOKIE); if (stored === "USD" || stored === "VND") selected = stored; } catch { /* Optional storage. */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    updateCurrency(selected); persistCurrency(selected);
  }, [initialCurrency]);
  useEffect(() => {
    let active = true, running = false;
    const controller = new AbortController();
    const refreshRate = async () => {
      if (running || !navigator.onLine) return;
      running = true;
      try {
        const response = await fetchWithDeadline("/api/exchange-rate", { signal: controller.signal, credentials: "omit" }, 8000);
        if (response.ok) {
          const { rate } = await response.json() as { rate?: ExchangeRate };
          if (active && usableExchangeRate(rate)) updateExchangeRate(current => !current || Date.parse(rate.updatedAt) >= Date.parse(current.updatedAt) ? rate : current);
        }
      } catch { /* Entered prices remain available when conversions cannot refresh. */ }
      finally { running = false; if (active) updateExchangeRate(current => usableExchangeRate(current) ? current : null); }
    };
    if (!usableExchangeRate(initial.exchangeRate)) void refreshRate();
    const timer = setInterval(() => void refreshRate(), 300000);
    window.addEventListener("online", refreshRate);
    return () => { active = false; controller.abort(); clearInterval(timer); window.removeEventListener("online", refreshRate); };
  }, [initial.exchangeRate]);
  useLayoutEffect(() => {
    let selected=initialLanguage;
    try{const stored=localStorage.getItem("gary-language");if(stored==="en"||stored==="vi")selected=stored;}catch{/* Optional storage. */}
    // Legacy browser-only preferences must settle before paint during hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    updateLanguage(selected);persistLanguage(selected);
    if(document.documentElement?.dataset)delete document.documentElement.dataset.languagePending;
  }, [initialLanguage]);
  const [saved, setSaved] = useState<string[]>([]);
  const [savedAccount, setSavedAccount] = useState<string | null>(null);
  const [savedError, setSavedError] = useState("");
  const [pendingSaved, setPendingSaved] = useState<string[]>([]);
  const savedFlight = useRef(new Set<string>());
  const savedVersion = useRef(0);
  const guestImportAttempts=useRef(new Set<string>()),guestImportFlights=useRef(new Map<string,Promise<number>>());
  const [guestImportError,setGuestImportError]=useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [publicClient,setPublicClient]=useState<SupabaseClient|null>(null);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [editor, setEditor] = useState(false);
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null);
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>("checking");
  const [demo, setDemo] = useState(false);
  const [enquiries, updateEnquiries] = useState<Enquiry[]>([]);
  const [toast, setToast] = useState("");
  const clientRef = useRef<SupabaseClient | null>(null);
  const sessionRef = useRef<SessionRecovery | null>(null);
  const snapshotRef = useRef<SessionState>({ user: null, editor: false, role: null, phase: "checking", generation: 0 });
  const initialRef = useRef(initial.content);
  useEffect(() => { initialRef.current = initial.content; }, [initial.content]);
  const version = useRef(0);
  const connectRef = useRef<() => Promise<void>>(async () => {});
  const refreshFlight = useRef<{ generation: number; promise: Promise<void> } | null>(null);
  const publicClientRef = useRef<SupabaseClient | null>(null);
  const publicContentNeeded = useRef(initial.error);
  const publicContentEpoch = useRef(0);
  const publicContentFlight = useRef<{ promise: Promise<void>; controller: AbortController } | null>(null);
  const activeUserId = user?.id;

  const refreshStaffProfile=useCallback(async()=>{
    const db=clientRef.current,state=sessionRef.current?.state;
    if(!db||!state?.editor||!state.user){setStaffProfile(null);return;}
    const id=state.user.id,generation=state.generation;
    const {data,error}=await request(signal=>db.rpc("get_staff_profile").abortSignal(signal));
    if(error)throw error;
    const current=sessionRef.current?.state;
    if(current?.user?.id!==id||current.generation!==generation||!current.editor)return;
    if(data&&data.user_id===id)setStaffProfile(data as StaffProfile);
  },[]);

  const verifyEmailLink=useCallback(async()=>{
    const input=pendingEmail.current,db=clientRef.current;
    if(!input||!db||verificationFlight.current)return;
    verificationFlight.current=true;setEmailVerification({type:input.type,busy:true,failed:false});
    try{
      const {data,error}=await request(()=>db.auth.verifyOtp({type:input.type,token_hash:input.tokenHash}));
      if(error)throw error;
      const verified=data.session;
      if(!verified||!data.user||verified.user.id!==data.user.id)throw {code:"otp_expired"};
      const current=await request(()=>db.auth.getSession());
      if(current.error||current.data.session?.user.id!==verified.user.id||snapshotRef.current.user?.id!==verified.user.id)throw {code:"identity_changed"};
      if(clientRef.current!==db||pendingEmail.current!==input)return;
      pendingEmail.current=null;setPasswordLink({type:input.type,userId:verified.user.id});setPasswordLinkIssue(null);setEmailVerification(null);
      const path=input.type==="invite"?"/auth/invite":"/auth/reset";
      if(window.location.pathname!==path)routerRef.current.replace(path);
    }catch(error){
      if(clientRef.current!==db||pendingEmail.current!==input)return;
      const code=(error as {code?:string})?.code;
      if(["otp_expired","access_denied","validation_failed","identity_changed"].includes(code||"")){
        pendingEmail.current=null;setEmailVerification(null);setPasswordLink(null);setPasswordLinkIssue(code==="otp_expired"?"expired":"invalid");
      }else setEmailVerification({type:input.type,busy:false,failed:true});
    }finally{verificationFlight.current=false;}
  },[]);

  const recoverPublicContent = useCallback(async () => {
    const db = publicClientRef.current;
    if (!publicContentNeeded.current || !db || !navigator.onLine) return;
    if (publicContentFlight.current) return publicContentFlight.current.promise;
    const epoch = publicContentEpoch.current, startedVersion = version.current;
    const controller = new AbortController();
    setContentRecovering(true);
    const promise = (async () => {
      try {
        const live = await readPublishedContent(db, controller.signal);
        if (epoch !== publicContentEpoch.current || controller.signal.aborted || !publicContentNeeded.current || startedVersion !== version.current) return;
        initialRef.current = live;
        publicContentNeeded.current = false;
        setBackendError(false);
        // Public recovery must not replace the Studio's full listing set or a
        // local save that completed while the anonymous read was pending.
        if (!snapshotRef.current.editor) updateContent(live);
      } catch {
        // Keep the warning truthful and let Retry/online/focus recover it later.
      }
    })();
    publicContentFlight.current = { promise, controller };
    try { await promise; } finally {
      if (publicContentFlight.current?.promise === promise) {
        publicContentFlight.current = null;
        if (epoch === publicContentEpoch.current) setContentRecovering(false);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    const db = clientRef.current, state = sessionRef.current?.state;
    if (!db || !state?.user || !state.editor) throw new Error("Sign in with an editor account to continue.");
    const generation = state.generation, startedVersion = version.current;
    if (refreshFlight.current?.generation === generation) return refreshFlight.current.promise;
    const promise = (async () => {
      const [p, n, s, a, act, e, orders, articles] = await request(signal => Promise.all([
        db.from("properties").select("*").order("sort_order").abortSignal(signal),
        db.from("neighbourhoods").select("*").order("sort_order").abortSignal(signal),
        db.from("site_settings").select("*").eq("id", "main").abortSignal(signal).single(),
        db.from("listing_authors").select("*").order("sort_order").abortSignal(signal),
        db.from("site_activities").select("*").order("sort_order").abortSignal(signal),
        db.from("enquiries").select(`${ENQUIRY_FIELDS},enquiry_notes(notes,read_at,read_by,property_code,property_address)`).order("created_at", { ascending: false }).abortSignal(signal),
        db.from("property_display_orders").select("scope,property_ids").abortSignal(signal),
        db.from("editorial_articles").select("*").order("updated_at",{ascending:false}).abortSignal(signal),
      ]));
      const current = sessionRef.current?.state;
      if (current?.generation !== generation || !current.editor || current.user?.id !== state.user?.id) return;
      if (p.error || n.error || s.error || e.error || a.error || act.error || orders.error || articles.error) throw new Error("Couldn’t load CMS data. Check your connection and editor permissions.");
      // A slow background read must not overwrite a save that completed meanwhile.
      if (startedVersion !== version.current) return;
      updateContent(contentAssets({ editorial:articles.data||[], properties: p.data, neighbourhoods: n.data, settings: s.data, authors:a.data||[],activities:act.data||[],propertyOrders:propertyOrders(orders.data) } as Content));
      initialRef.current = contentAssets({ editorial:(articles.data||[]).filter(row=>row.status==="published"), properties: p.data.filter(isPublicRental), neighbourhoods: n.data, settings: s.data,authors:(a.data||[]).filter(row=>row.published),activities:(act.data||[]).filter(row=>row.published),propertyOrders:propertyOrders(orders.data) } as Content);
      publicContentNeeded.current = false;
      setBackendError(false);
      updateEnquiries(e.data.map(row => {
        const { enquiry_notes, ...enquiry } = row;
        type PrivateNotes=Pick<Enquiry,"notes"|"read_at"|"read_by"|"property_code"|"property_address">;
        const privateNotes = enquiry_notes as unknown as PrivateNotes | PrivateNotes[] | null;
        const note=Array.isArray(privateNotes)?privateNotes[0]:privateNotes;
        return { ...enquiry, notes:note?.notes??"",read_at:note?.read_at??null,read_by:note?.read_by??null,property_code:note?.property_code||"",property_address:note?.property_address||"" } as Enquiry;
      }));
    })();
    refreshFlight.current = { generation, promise };
    try { await promise; } finally { if (refreshFlight.current?.promise === promise) refreshFlight.current = null; }
  }, []);

  const reconnect = useCallback(async () => {
    if (!sessionRef.current) { await connectRef.current(); await recoverPublicContent(); return; }
    const publicRecovery = recoverPublicContent();
    if (await sessionRef.current.recover()) {
      try { await refresh(); } catch (error) { setToast(error instanceof Error ? error.message : "Couldn’t load CMS data. Check your connection and editor permissions."); }
    }
    await publicRecovery;
  }, [refresh, recoverPublicContent]);

  const editorTask = useCallback(async <T,>(operation: (db: SupabaseClient, signal: AbortSignal) => PromiseLike<T>): Promise<T> => {
    const expectedGeneration = snapshotRef.current.generation;
    if (!activeUserId || snapshotRef.current.user?.id !== activeUserId) throw new Error("Your account changed. Sign in again before continuing.");
    if (!sessionRef.current) await connectRef.current();
    const recovery = sessionRef.current, db = clientRef.current;
    if (!recovery || !db || !await recovery.recover()) throw new Error("Reconnect and verify your editor access before saving. Your edits are still here.");
    const { generation, user } = recovery.state;
    if (generation !== expectedGeneration || user?.id !== activeUserId) throw new Error("Your account changed during this request. Check the current data before continuing.");
    const result = await request(signal => operation(db, signal));
    if (recovery.state.generation !== generation || recovery.state.user?.id !== user?.id || !recovery.state.editor) {
      throw new Error("Your account changed during this request. Check the current data before continuing.");
    }
    return result;
  }, [activeUserId]);

  const accountTask = useCallback(async <T,>(operation: (db: SupabaseClient, signal: AbortSignal, userId: string) => PromiseLike<T>): Promise<T> => {
    const expectedGeneration = snapshotRef.current.generation;
    if (!activeUserId || snapshotRef.current.user?.id !== activeUserId) throw new Error("Your account changed. Sign in again before continuing.");
    if (!sessionRef.current) await connectRef.current();
    const recovery = sessionRef.current, db = clientRef.current;
    if (!recovery || !db) throw new Error("Reconnect before continuing.");
    await recovery.recover();
    const { generation, user, phase } = recovery.state;
    if (generation !== expectedGeneration || user?.id !== activeUserId) throw new Error("Your account changed during this request. Check the current data before continuing.");
    if (!user || phase !== "ready") throw new Error("Reconnect and sign in before continuing.");
    const result = await request(signal => operation(db, signal, user.id));
    if (recovery.state.generation !== generation || recovery.state.user?.id !== user.id) {
      throw new Error("Your account changed during this request. Check the current data before continuing.");
    }
    return result;
  }, [activeUserId]);

  useEffect(() => {
    let active = true, unsubscribe: (() => void) | undefined;
    const contentEpoch = publicContentEpoch.current;
    let connecting: Promise<void> | null = null;
    queueMicrotask(() => {
    if (!active) return;
    try {
      setSaved(readBrowserFavourites(localStorage));
      if (!initial.configured) {
        updateEnquiries(JSON.parse(localStorage.getItem("gary-preview-enquiries") || "[]"));
        if (localStorage.getItem("gary-preview-enabled") === "true") {
          const stored = localStorage.getItem("gary-preview-content"); if (stored) updateContent(JSON.parse(stored));
          setDemo(true);
        }
      }
    } catch { /* Optional browser storage. */ }
    });
    const connect = (): Promise<void> => {
      if (connecting) return connecting;
      const task = (async () => {
        try {
          if (!navigator.onLine) { setSessionPhase("offline"); return; }
          // Capture the intended identity before the SDK consumes the URL.
          let pendingLink=passwordLinkEvidence(window.location.hash||"");
          if(pendingLink)setPasswordLink(pendingLink);
          setPasswordLinkIssue(emailLinkIssue(window.location.hash||"",window.location.search));
          const token=emailTokenLink(window.location.hash||"",window.location.search);
          if(token){
            pendingEmail.current=token;setEmailVerification({type:token.type,busy:false,failed:false});
            // Keep one-time credentials in memory, out of navigation/referrers.
            const clean=new URL(window.location.href);
            for(const params of [clean.searchParams,new URLSearchParams(clean.hash.slice(1))]){
              if(!params.has("token_hash"))continue;params.delete("token_hash");params.delete("type");
              if(params!==clean.searchParams)clean.hash=params.toString();
            }
            window.history?.replaceState(window.history.state,"",clean.pathname+clean.search+clean.hash);
            const path=token.type==="invite"?"/auth/invite":"/auth/reset";
            if(window.location.pathname!==path)routerRef.current.replace(path);
          }
          setSessionPhase("checking");
          const response = await fetchWithDeadline("/api/config", { cache: "no-store" }, 10000);
          if (!response.ok) throw new Error("Configuration unavailable");
          const config = await response.json() as { configured: boolean; url: string; publishableKey: string };
          if (!active) return;
          if (!config.configured) { setSessionPhase("ready"); return; }
          const publicDb=publicBrowserClient(config.url,config.publishableKey);publicClientRef.current=publicDb;setPublicClient(publicDb);
          if (publicContentNeeded.current) {
            void recoverPublicContent();
          }
          const db = browserClient(config.url, config.publishableKey);
          clientRef.current = db; setClient(db);
          const recovery = new SessionRecovery({
            getSession: () => db.auth.getSession(),
            getRole: async (id, signal) => {
              const { data, error } = await db.from("team_members").select("role").eq("user_id", id).abortSignal(signal).maybeSingle();
              if (error) throw error;
              return data?.role ?? null;
            },
            online: () => navigator.onLine,
            onChange: next => {
              if (!active) return;
              const previous = snapshotRef.current; snapshotRef.current = next;
              setUser(next.user); setEditor(next.editor); setStaffRole(next.role); setSessionPhase(next.phase);
              if (previous.user?.id !== next.user?.id) {
                setStaffProfile(null);savedVersion.current++; setSavedAccount(null); setSavedError(""); setGuestImportError(false); setPendingSaved([]);
                if (next.user) setSaved([]);
                else { try { setSaved(readBrowserFavourites(localStorage)); } catch { setSaved([]); } }
              }
              if (next.phase !== "checking" && next.phase !== "recovering") setReady(true);
              if (previous.user && (next.user?.id !== previous.user.id || previous.editor && !next.editor && next.phase === "ready")) {
                if(!next.editor)setStaffProfile(null);version.current++; updateEnquiries([]); updateContent(initialRef.current);
                if(next.user?.id!==previous.user.id)setPasswordLink(null);
              }
            },
          });
          sessionRef.current = recovery;
          // Subscribe before the first read. Keep this callback synchronous.
          let latestAuthUser:string|null=null;
          const { data } = db.auth.onAuthStateChange((event, session) => {
            latestAuthUser=session?.user.id||null;
            recovery.observe(session);
            const fromHash=pendingLink&&pendingLink.userId===latestAuthUser?pendingLink:null;
            if(fromHash)pendingLink=null;
            const link:PasswordLink|null=event==="PASSWORD_RECOVERY"&&session?{type:"recovery",userId:session.user.id}:fromHash;
            if(link){
              setPasswordLink(link);
              const path=link.type==="invite"?"/auth/invite":"/auth/reset";
              // A provider fallback to the site root must still reach the form.
              queueMicrotask(()=>{if(active&&latestAuthUser===link.userId&&window.location.pathname!==path)routerRef.current.replace(path);});
            }
          });
          unsubscribe = () => data.subscription.unsubscribe();
          await recovery.recover();
        } catch { if (active) setSessionPhase(navigator.onLine ? "error" : "offline"); }
        finally { if (active) setReady(true); }
      })();
      connecting = task;
      void task.finally(() => { if (connecting === task) connecting = null; });
      return task;
    };
    connectRef.current = connect;
    const offline = () => { if (sessionRef.current) sessionRef.current.offline(); else setSessionPhase("offline"); };
    const removeRecoveryEvents = installRecoveryEvents(reconnect, offline);
    void connect();
    return () => {
      active = false; unsubscribe?.(); sessionRef.current?.stop(); sessionRef.current = null; clientRef.current = null;
      publicContentEpoch.current = contentEpoch + 1; publicContentFlight.current?.controller.abort(); publicContentFlight.current = null; publicClientRef.current = null;
      removeRecoveryEvents();
    };
  }, [initial.configured, reconnect, recoverPublicContent]);

  useEffect(() => {
    if (!client || !user || sessionPhase !== "ready") return;
    let active = true;
    const identity = user.id, generation = snapshotRef.current.generation, startedVersion = savedVersion.current;
    void request(signal => client.from("saved_homes").select("property_id").eq("user_id", identity).abortSignal(signal))
      .then(({ data, error }) => {
        if (!active || snapshotRef.current.generation !== generation || startedVersion !== savedVersion.current) return;
        if (error) { setSavedError(customerError(error, language)); return; }
        setSaved((data ?? []).map(row => row.property_id as string)); setSavedAccount(identity); setSavedError("");
      }).catch(error => { if (active) setSavedError(customerError(error, language)); });
    return () => { active = false; };
    // Language changes must not refetch private data or overwrite pending saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, user?.id, sessionPhase]);

  useEffect(() => {
    const syncLanguage = (event: StorageEvent) => { if (event.key === "gary-language") {const selected=languageValue(event.newValue);updateLanguage(selected);persistLanguage(selected);} if(event.key===CURRENCY_COOKIE){const selected=currencyValue(event.newValue);updateCurrency(selected);persistCurrency(selected);} };
    window.addEventListener("storage", syncLanguage); return () => window.removeEventListener("storage", syncLanguage);
  }, []);
  useLayoutEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 4500); return () => clearTimeout(timer); }, [toast]);
  const setContent = useCallback((next: Update<Content>) => {
    version.current++;
    updateContent(previous => {
      const value = typeof next === "function" ? next(previous) : next;
      if (demo) { try { localStorage.setItem("gary-preview-content", JSON.stringify(value)); } catch { setToast("Browser storage is full. Changes are only kept for this session."); } }
      else initialRef.current={...value,editorial:(value.editorial||[]).filter(row=>row.status==="published"),properties:value.properties.filter(isPublicRental),authors:(value.authors||[]).filter(row=>row.published),activities:(value.activities||[]).filter(row=>row.published)};
      return value;
    });
  }, [demo]);
  function setEnquiries(next: Update<Enquiry[]>) {
    version.current++;
    updateEnquiries(previous => {
      const value = typeof next === "function" ? next(previous) : next;
      if (!initial.configured) { try { localStorage.setItem("gary-preview-enquiries", JSON.stringify(value)); } catch { setToast("Browser storage is unavailable."); } }
      return value;
    });
  }
  function toggleSaved(id: string) {
    if (!user) { setSaved(previous => { const next = previous.includes(id) ? previous.filter(x => x !== id) : [...previous, id]; try { localStorage.setItem("gary-saved", JSON.stringify(next));if(!next.includes(id))releaseBrowserFavouriteClaim(localStorage,id); } catch { setToast("Saved for this visit. Browser storage is unavailable."); } return next; }); return; }
    const identity = user.id, key = identity + ":" + id, remove = saved.includes(id);
    if (savedFlight.current.has(key)) return;
    if (savedAccount !== identity) { setToast(language === "vi" ? "Đang kết nối danh sách nhà đã lưu. Hãy kết nối lại và thử lại." : "Your saved homes are still connecting. Reconnect and try again."); return; }
    savedFlight.current.add(key); savedVersion.current++; setPendingSaved(previous => [...previous, id]);
    void accountTask((db, signal, userId) => remove
      ? db.from("saved_homes").delete().eq("user_id", userId).eq("property_id", id).select("property_id").abortSignal(signal)
      : db.from("saved_homes").upsert({ user_id: userId, property_id: id }, { onConflict: "user_id,property_id", ignoreDuplicates: true }).select("property_id").abortSignal(signal))
      .then(({ error }) => {
        if (error) throw error;
        if (snapshotRef.current.user?.id === identity) { savedVersion.current++; setSaved(previous => remove ? previous.filter(value => value !== id) : previous.includes(id) ? previous : [...previous, id]); }
      }).catch(error => { if (snapshotRef.current.user?.id === identity) setToast(customerError(error, language)); })
      .finally(() => { savedFlight.current.delete(key); if (snapshotRef.current.user?.id === identity) setPendingSaved(previous => previous.filter(value => value !== id)); });
  }
  async function importSaved():Promise<number> {
    if (!user || savedAccount !== user.id) throw new Error("Reconnect before continuing.");
    const identity=user.id,generation=snapshotRef.current.generation,key=identity+":"+generation;
    const running=guestImportFlights.current.get(key);if(running)return running;
    const task=(async()=>{
      const stored=readBrowserFavourites(localStorage),valid=new Set(content.properties.filter(isPublicRental).map(property=>property.id));
      const candidates=stored.filter(id=>valid.has(id)).slice(0,100);if(!candidates.length){setGuestImportError(false);return 0;}
      const ids=claimBrowserFavourites(localStorage,identity,candidates);if(!ids.length)return 0;
      const existing=new Set(saved),additions=ids.filter(id=>!existing.has(id));savedVersion.current++;
      if(additions.length){const {error}=await accountTask((db,signal,userId)=>db.from("saved_homes").upsert(additions.map(property_id=>({user_id:userId,property_id})),{onConflict:"user_id,property_id",ignoreDuplicates:true}).select("property_id").abortSignal(signal));if(error)throw error;}
      if(snapshotRef.current.user?.id!==identity||snapshotRef.current.generation!==generation)throw new Error("Your account changed during this request.");
      savedVersion.current++;setSaved(previous=>[...new Set([...previous,...ids])]);
      acknowledgeBrowserFavourites(localStorage,identity,ids);setGuestImportError(false);return additions.length;
    })();guestImportFlights.current.set(key,task);
    try{return await task;}finally{if(guestImportFlights.current.get(key)===task)guestImportFlights.current.delete(key);}
  }
  useEffect(()=>{
    if(!user||savedAccount!==user.id||sessionPhase!=="ready")return;
    const identity=user.id,generation=snapshotRef.current.generation,key=identity+":"+generation;
    if(guestImportAttempts.current.has(key))return;guestImportAttempts.current.add(key);
    void importSaved().catch(()=>{if(snapshotRef.current.user?.id===identity&&snapshotRef.current.generation===generation)setGuestImportError(true);});
    // Once per authenticated generation. Manual Sync remains available after a
    // failure; language changes and auth recovery never replay a pending write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[user?.id,savedAccount,sessionPhase]);
  function toggleCompare(id: string) { setCompare(previous => previous.includes(id) ? previous.filter(x => x !== id) : previous.length < 3 ? [...previous, id] : (setToast(language === "en" ? "Compare up to 3 homes at a time." : "So sánh tối đa 3 căn hộ."), previous)); }
  function enterDemo() { setDemo(true); try { localStorage.setItem("gary-preview-enabled", "true"); } catch { /* optional */ } }
  function exitDemo() { setDemo(false); updateContent(initialRef.current); try { localStorage.removeItem("gary-preview-enabled"); } catch { /* optional */ } }
  useEffect(()=>{
    if(!client)return;
    let active=true;
    if(editor&&sessionPhase==="ready")void refreshStaffProfile().catch(()=>{});
    const changed=()=>{
      if(editor)void refreshStaffProfile().catch(()=>{});
      const state=snapshotRef.current,actor=state.user?.id,generation=state.generation;
      void request(async signal=>{
        let query=client.from("listing_authors").select("*");if(!editor)query=query.eq("published",true);
        return await query.order("sort_order").abortSignal(signal);
      }).then(({data,error})=>{
        if(!active||error||snapshotRef.current.user?.id!==actor||snapshotRef.current.generation!==generation||!Array.isArray(data))return;
        version.current++;updateContent(previous=>({...previous,authors:data}));initialRef.current={...initialRef.current,authors:data.filter(a=>a.published)};
      }).catch(()=>{});
      window.dispatchEvent(new Event("gary-staff-directory-changed"));
    };
    window.addEventListener("gary-staff-profile-changed",changed);
    const channel=typeof client.channel==="function"?client.channel("gary-staff-portraits").on("postgres_changes",{event:"*",schema:"public",table:"staff_profiles"},changed).subscribe():null;
    return()=>{active=false;window.removeEventListener("gary-staff-profile-changed",changed);if(channel)void client.removeChannel(channel);};
  },[client,editor,activeUserId,refreshStaffProfile,sessionPhase]);

  const sessionMessage = sessionPhase === "offline" ? "You’re offline. Your edits are still here. Reconnect before saving." : sessionPhase === "error" ? "We couldn’t verify your connection. Your edits are still here." : "Restoring your session…";
  return <Context.Provider value={{ content, setContent, currency, setCurrency, exchangeRate, language, setLanguage: l => { updateLanguage(l); persistLanguage(l); }, t: (en, vi) => language === "vi" ? vi : en, saved, toggleSaved, savedReady: !user || savedAccount === user.id, savedError:savedError||(guestImportError?(language==="vi"?"Chưa thể đồng bộ nhà yêu thích trên trình duyệt. Danh sách vẫn được giữ trên thiết bị; hãy thử Đồng bộ trong tài khoản.":"Browser favourites could not be synced. They remain on this device; retry Sync from your account."):""), pendingSaved, importSaved, compare, toggleCompare, configured: initial.configured, backendError, client, publicClient, ready, user, editor, staffRole, staffProfile,refreshStaffProfile,passwordLink,passwordLinkIssue,emailVerification,verifyEmailLink, sessionPhase, reconnect, editorTask, accountTask, demo, enterDemo, exitDemo, enquiries, setEnquiries, refresh, notice: setToast }}>
    {initial.configured && ["offline", "error", "recovering"].includes(sessionPhase) && <div className="session-banner" role="status">{studioText(sessionMessage, language)}{sessionPhase !== "recovering" && <button type="button" onClick={() => void reconnect()}>{studioText("Reconnect", language)}</button>}</div>}
    {demo && <div className="preview-banner">{studioText("CMS preview · changes and enquiries stay in this browser", language)} <button onClick={exitDemo}>{studioText("Exit preview", language)}</button></div>}
    {backendError && <div className="service-banner" role="status">{studioText("We couldn’t refresh listings. Showing reference listings; please confirm prices and availability with the team.", language)} <button type="button" disabled={contentRecovering} onClick={() => void reconnect()}>{studioText(contentRecovering ? "Refreshing listings…" : "Retry", language)}</button></div>}
    {children}{toast && <div className="toast" role="status">{studioText(toast, language)}<button aria-label={studioText("Dismiss notification", language)} onClick={() => setToast("")}>×</button></div>}
  </Context.Provider>;
}
export function useSite() { const context = useContext(Context); if (!context) throw new Error("SiteProvider is required"); return context; }
