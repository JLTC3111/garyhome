"use client";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Content, Enquiry, Language } from "@/lib/types";
import { languageValue, persistLanguage } from "@/lib/language";
import { studioText } from "@/lib/studio-i18n";
import { browserClient, publicBrowserClient } from "@/lib/browser-client";
import { readPublishedContent } from "@/lib/public-content";
import { installRecoveryEvents } from "@/lib/recovery-events";
import { fetchWithDeadline, request } from "@/lib/requests";
import { SessionRecovery, type SessionPhase, type SessionState } from "@/lib/session-recovery";
import { customerError, ENQUIRY_FIELDS } from "@/lib/customer-data";
import { isPublicRental } from "@/lib/rentals";
import type { StaffRole } from "@/lib/staff";

type Update<T> = T | ((previous: T) => T);
type SiteContext = {
  content: Content; setContent: (content: Update<Content>) => void;
  language: Language; setLanguage: (l: Language) => void; t: (en: string, vi: string) => string;
  saved: string[]; toggleSaved: (id: string) => void;
  savedReady: boolean; savedError: string; pendingSaved: string[];
  importSaved: () => Promise<number>;
  compare: string[]; toggleCompare: (id: string) => void;
  configured: boolean; backendError: boolean; client: SupabaseClient | null; ready: boolean;
  user: User | null; editor: boolean; staffRole: StaffRole | null; demo: boolean; enterDemo: () => void; exitDemo: () => void;
  sessionPhase: SessionPhase; reconnect: () => Promise<void>;
  editorTask: <T>(operation: (db: SupabaseClient, signal: AbortSignal) => PromiseLike<T>) => Promise<T>;
  accountTask: <T>(operation: (db: SupabaseClient, signal: AbortSignal, userId: string) => PromiseLike<T>) => Promise<T>;
  enquiries: Enquiry[]; setEnquiries: (list: Update<Enquiry[]>) => void; refresh: () => Promise<void>;
  notice: (message: string) => void;
};
const Context = createContext<SiteContext | null>(null);
export function SiteProvider({ children, initial, initialLanguage = "en" }: { children: ReactNode; initialLanguage?: Language; initial: { content: Content; configured: boolean; error: boolean } }) {
  const [content, updateContent] = useState(initial.content);
  const [backendError, setBackendError] = useState(initial.error);
  const [contentRecovering, setContentRecovering] = useState(false);
  const [language, updateLanguage] = useState<Language>(initialLanguage);
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
  const [compare, setCompare] = useState<string[]>([]);
  const [client, setClient] = useState<SupabaseClient | null>(null);
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
      const [p, n, s, a, act, e] = await request(signal => Promise.all([
        db.from("properties").select("*").order("sort_order").abortSignal(signal),
        db.from("neighbourhoods").select("*").order("sort_order").abortSignal(signal),
        db.from("site_settings").select("*").eq("id", "main").abortSignal(signal).single(),
        db.from("listing_authors").select("*").order("sort_order").abortSignal(signal),
        db.from("site_activities").select("*").order("sort_order").abortSignal(signal),
        db.from("enquiries").select(`${ENQUIRY_FIELDS},enquiry_notes(notes)`).order("created_at", { ascending: false }).abortSignal(signal),
      ]));
      const current = sessionRef.current?.state;
      if (current?.generation !== generation || !current.editor || current.user?.id !== state.user?.id) return;
      if (p.error || n.error || s.error || e.error || a.error || act.error) throw new Error("Couldn’t load CMS data. Check your connection and editor permissions.");
      // A slow background read must not overwrite a save that completed meanwhile.
      if (startedVersion !== version.current) return;
      updateContent({ properties: p.data, neighbourhoods: n.data, settings: s.data, authors:a.data||[],activities:act.data||[] } as Content);
      initialRef.current = { properties: p.data.filter(isPublicRental), neighbourhoods: n.data, settings: s.data,authors:(a.data||[]).filter(row=>row.published),activities:(act.data||[]).filter(row=>row.published) } as Content;
      publicContentNeeded.current = false;
      setBackendError(false);
      updateEnquiries(e.data.map(row => {
        const { enquiry_notes, ...enquiry } = row;
        const privateNotes = enquiry_notes as unknown as { notes: string } | { notes: string }[] | null;
        return { ...enquiry, notes: Array.isArray(privateNotes) ? privateNotes[0]?.notes ?? "" : privateNotes?.notes ?? "" } as Enquiry;
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
      const ids = JSON.parse(localStorage.getItem("gary-saved") || "[]");
      setSaved(Array.isArray(ids) ? ids.filter(id => typeof id === "string") : []);
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
          setSessionPhase("checking");
          const response = await fetchWithDeadline("/api/config", { cache: "no-store" }, 10000);
          if (!response.ok) throw new Error("Configuration unavailable");
          const config = await response.json() as { configured: boolean; url: string; publishableKey: string };
          if (!active) return;
          if (!config.configured) { setSessionPhase("ready"); return; }
          if (publicContentNeeded.current) {
            publicClientRef.current = publicBrowserClient(config.url, config.publishableKey);
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
                savedVersion.current++; setSavedAccount(null); setSavedError(""); setPendingSaved([]);
                if (next.user) setSaved([]);
                else { try { const ids = JSON.parse(localStorage.getItem("gary-saved") || "[]"); setSaved(Array.isArray(ids) ? ids.filter(id => typeof id === "string") : []); } catch { setSaved([]); } }
              }
              if (next.phase !== "checking" && next.phase !== "recovering") setReady(true);
              if (previous.user && (next.user?.id !== previous.user.id || previous.editor && !next.editor && next.phase === "ready")) {
                version.current++; updateEnquiries([]); updateContent(initialRef.current);
              }
            },
          });
          sessionRef.current = recovery;
          // Subscribe before the first read. Keep this callback synchronous.
          const { data } = db.auth.onAuthStateChange((_event, session) => { recovery.observe(session); });
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
    const syncLanguage = (event: StorageEvent) => { if (event.key === "gary-language") {const selected=languageValue(event.newValue);updateLanguage(selected);persistLanguage(selected);} };
    window.addEventListener("storage", syncLanguage); return () => window.removeEventListener("storage", syncLanguage);
  }, []);
  useLayoutEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 4500); return () => clearTimeout(timer); }, [toast]);
  const setContent = useCallback((next: Update<Content>) => {
    version.current++;
    updateContent(previous => {
      const value = typeof next === "function" ? next(previous) : next;
      if (demo) { try { localStorage.setItem("gary-preview-content", JSON.stringify(value)); } catch { setToast("Browser storage is full. Changes are only kept for this session."); } }
      else initialRef.current={...value,properties:value.properties.filter(isPublicRental),authors:(value.authors||[]).filter(row=>row.published),activities:(value.activities||[]).filter(row=>row.published)};
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
    if (!user) { setSaved(previous => { const next = previous.includes(id) ? previous.filter(x => x !== id) : [...previous, id]; try { localStorage.setItem("gary-saved", JSON.stringify(next)); } catch { setToast("Saved for this visit. Browser storage is unavailable."); } return next; }); return; }
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
  async function importSaved() {
    if (!user || savedAccount !== user.id) throw new Error("Reconnect before continuing.");
    const identity = user.id;
    let stored: unknown;
    try { stored = JSON.parse(localStorage.getItem("gary-saved") || "[]"); } catch { stored = []; }
    const valid = new Set(content.properties.filter(property => property.status === "published").map(property => property.id));
    const ids = Array.isArray(stored) ? [...new Set(stored.filter((id): id is string => typeof id === "string" && valid.has(id)))].slice(0, 100) : [];
    if (!ids.length) return 0;
    savedVersion.current++;
    const { error } = await accountTask((db, signal, userId) => db.from("saved_homes").upsert(ids.map(property_id => ({ user_id: userId, property_id })), { onConflict: "user_id,property_id", ignoreDuplicates: true }).select("property_id").abortSignal(signal));
    if (error) throw error;
    if (snapshotRef.current.user?.id !== identity) throw new Error("Your account changed during this request.");
    savedVersion.current++; setSaved(previous => [...new Set([...previous, ...ids])]);
    return ids.length;
  }
  function toggleCompare(id: string) { setCompare(previous => previous.includes(id) ? previous.filter(x => x !== id) : previous.length < 3 ? [...previous, id] : (setToast(language === "en" ? "Compare up to 3 homes at a time." : "So sánh tối đa 3 căn hộ."), previous)); }
  function enterDemo() { setDemo(true); try { localStorage.setItem("gary-preview-enabled", "true"); } catch { /* optional */ } }
  function exitDemo() { setDemo(false); updateContent(initialRef.current); try { localStorage.removeItem("gary-preview-enabled"); } catch { /* optional */ } }
  const sessionMessage = sessionPhase === "offline" ? "You’re offline. Your edits are still here. Reconnect before saving." : sessionPhase === "error" ? "We couldn’t verify your connection. Your edits are still here." : "Restoring your session…";
  return <Context.Provider value={{ content, setContent, language, setLanguage: l => { updateLanguage(l); persistLanguage(l); }, t: (en, vi) => language === "vi" ? vi : en, saved, toggleSaved, savedReady: !user || savedAccount === user.id, savedError, pendingSaved, importSaved, compare, toggleCompare, configured: initial.configured, backendError, client, ready, user, editor, staffRole, sessionPhase, reconnect, editorTask, accountTask, demo, enterDemo, exitDemo, enquiries, setEnquiries, refresh, notice: setToast }}>
    {initial.configured && ["offline", "error", "recovering"].includes(sessionPhase) && <div className="session-banner" role="status">{studioText(sessionMessage, language)}{sessionPhase !== "recovering" && <button type="button" onClick={() => void reconnect()}>{studioText("Reconnect", language)}</button>}</div>}
    {demo && <div className="preview-banner">{studioText("CMS preview · changes and enquiries stay in this browser", language)} <button onClick={exitDemo}>{studioText("Exit preview", language)}</button></div>}
    {backendError && <div className="service-banner" role="status">{studioText("We couldn’t refresh listings. Showing reference listings; please confirm prices and availability with the team.", language)} <button type="button" disabled={contentRecovering} onClick={() => void reconnect()}>{studioText(contentRecovering ? "Refreshing listings…" : "Retry", language)}</button></div>}
    {children}{toast && <div className="toast" role="status">{studioText(toast, language)}<button aria-label={studioText("Dismiss notification", language)} onClick={() => setToast("")}>×</button></div>}
  </Context.Provider>;
}
export function useSite() { const context = useContext(Context); if (!context) throw new Error("SiteProvider is required"); return context; }
