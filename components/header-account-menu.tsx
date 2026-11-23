"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { ChevronDown, Heart, House, LayoutDashboard, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { usePathname } from "next/navigation";
import { unlocalizedPath } from "@/lib/localized-routes";
import { request } from "@/lib/requests";
import { CUSTOMER_ACCOUNT_URL, STAFF_PORTAL_ORIGIN } from "@/lib/site-origin";
import type { StaffRole } from "@/lib/staff";
import Link from "./localized-link";
import { useSite } from "./site-context";

const staffDashboard = `${STAFF_PORTAL_ORIGIN}/admin`;

function subscribeAccountLocation(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  // Account tabs update the query with replaceState, which does not emit popstate.
  document.addEventListener("click", onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
    document.removeEventListener("click", onStoreChange);
  };
}
function readAccountSearch() { return window.location.search; }
function serverAccountSearch() { return null; }

function accountDestinationCurrent(href: string, pathname: string, search: string | null) {
  let target: URL;
  try { target = new URL(href, "https://garyhome.local"); } catch { return false; }
  const currentPath = unlocalizedPath(pathname).replace(/\/+$/, "") || "/";
  const targetPath = unlocalizedPath(target.pathname).replace(/\/+$/, "") || "/";
  if (currentPath !== targetPath) return false;
  if (targetPath === "/account") {
    if (search === null) return false;
    const tab = new URLSearchParams(search).get("tab");
    return target.searchParams.get("tab") === "profile" ? tab === "profile" : !tab || tab === "overview";
  }
  if ([...target.searchParams].length > 0) {
    if (search === null) return false;
    const current = new URLSearchParams(search);
    return [...target.searchParams].every(([key, value]) => current.get(key) === value);
  }
  return true;
}
const roleNames: Record<StaffRole, [string, string]> = {
  owner: ["Owner", "Chủ sở hữu"],
  admin: ["Admin", "Quản trị viên"],
  manager: ["Manager", "Quản lý"],
  editor: ["Editor", "Biên tập viên"],
};

type CustomerAccess = { profile: boolean; saved: boolean; name: string; unavailable: boolean };
type StaffMenuActions = {
  dashboard: () => void; profile: () => void; signedOut: () => void; trigger: RefObject<HTMLButtonElement | null>;
};

function AccountAvatar({ photo, name = "" }: { photo?: string; name?: string }) {
  const [failedPhoto, setFailedPhoto] = useState("");
  const words = name.trim().split(/\s+/);
  const initials = (words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1][0] : "");
  return <span className="header-account-avatar" aria-hidden="true">
    {photo && failedPhoto !== photo ? <img src={photo} alt="" onError={() => setFailedPhoto(photo)}/>
      : initials ? initials.toLocaleUpperCase() : <UserRound size={18}/>}
  </span>;
}

export function HeaderAccountMenu({ onOpen, customerAvatar = false, staffActions }: {
  onOpen?: () => void; customerAvatar?: boolean; staffActions?: StaffMenuActions;
}) {
  const { t, user, client, editor, staffRole, staffProfile, sessionResolved, sessionExpired,
    staffAccessRevoked, sessionPhase, revalidateSession, signOutSession } = useSite();
  const identity = sessionResolved ? user?.id ?? "guest" : "restoring";
  const [disclosure, setDisclosure] = useState({ identity, open: false });
  const [customer, setCustomer] = useState<CustomerAccess | null>(null);
  const [checking, setChecking] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null), defaultTrigger = useRef<HTMLButtonElement>(null);
  const trigger = staffActions?.trigger ?? defaultTrigger;
  const verification = useRef<AbortController | null>(null);
  const id = useId();
  const pathname = usePathname() || "";
  const accountSearch = useSyncExternalStore(subscribeAccountLocation, readAccountSearch, serverAccountSearch);
  const currentDestination = (href: string) => accountDestinationCurrent(href, pathname, accountSearch) ? "page" as const : undefined;

  if (identity !== disclosure.identity) {
    setDisclosure({ identity, open: false });
    setCustomer(null);
    setChecking(false);
    setSigningOut(false);
    setSignOutFailed(false);
  }
  const open = disclosure.identity === identity && disclosure.open;
  const close = () => setDisclosure({ identity, open: false });

  useEffect(() => () => {
    verification.current?.abort();
    verification.current = null;
  }, [identity]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setDisclosure({ identity, open: false });
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [identity, open]);

  async function checkAccess() {
    if (!user || !client || verification.current) return;
    const check = new AbortController();
    verification.current = check;
    setChecking(true);
    try {
      // A successful self-service read also covers new customers with no profile row.
      const [, [profile, saved]] = await Promise.all([revalidateSession(), request(signal => {
        const abort = AbortSignal.any([signal, check.signal]);
        return Promise.all([
          client.from("customer_profiles").select(staffActions ? "user_id" : "full_name").eq("user_id", user.id).abortSignal(abort).maybeSingle(),
          staffActions ? null : client.from("saved_homes").select("property_id", { head: true }).eq("user_id", user.id).limit(1).abortSignal(abort),
        ]);
      })]);
      if (check.signal.aborted) return;
      const profileName = profile.data && "full_name" in profile.data ? profile.data.full_name : undefined;
      setCustomer({
        profile: !profile.error, saved: !!saved && !saved.error, name: typeof profileName === "string" ? profileName.trim() : "",
        unavailable: [profile, saved].some(result => result?.error && result.error.code !== "42501" && result.status !== 403),
      });
    } catch {
      if (!check.signal.aborted) setCustomer({ profile: false, saved: false, name: "", unavailable: true });
    } finally {
      if (verification.current === check) {
        verification.current = null;
        setChecking(false);
      }
    }
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutFailed(false);
    try {
      await signOutSession();
      staffActions?.signedOut();
      setDisclosure(previous => ({ ...previous, open: false }));
      trigger.current?.focus({ preventScroll: true });
    } catch { setSignOutFailed(true); }
    finally { setSigningOut(false); }
  }

  if (!sessionResolved) {
    const pending = sessionPhase === "checking" || sessionPhase === "recovering";
    return <div className="header-account-menu">
      {pending ? <span className="header-account-trigger" role="status"><AccountAvatar/><span className="header-account-trigger-label">{t("Checking session…", "Đang kiểm tra phiên…")}</span></span>
        : <button className="header-account-trigger" type="button" aria-label={t("Retry session check", "Kiểm tra lại phiên đăng nhập")} onClick={() => void revalidateSession()}>
          <AccountAvatar/><span className="header-account-trigger-label">{t("Retry session check", "Kiểm tra lại phiên đăng nhập")}</span>
        </button>}
    </div>;
  }

  const role = sessionPhase === "ready" && editor ? staffRole : null;
  const staff = !customerAvatar && role && staffProfile?.user_id === user?.id ? staffProfile : null;
  const photo = staff?.avatar_path && client ? client.storage.from("staff-avatars").getPublicUrl(staff.avatar_path).data.publicUrl : "";
  const email = user?.email ?? "";
  const signupName = user?.user_metadata?.full_name;
  const name = staff?.display_name?.trim() || (!staffActions && customer?.name) || (typeof signupName === "string" ? signupName.trim() : "") || email;
  const verified = sessionPhase === "ready" && !checking && customer !== null;
  const showStaff = verified && !!role;
  const showProfile = verified && customer.profile;
  const showSaved = verified && customer.saved;
  const canRetry = sessionPhase !== "ready" || customer?.unavailable;
  const label = staffActions ? t("Staff account", "Tài khoản nhân viên") : user ? t("My account", "Tài khoản của tôi") : t("Sign in", "Đăng nhập");
  return <div className={staffActions ? "header-account-menu staff-account-menu" : "header-account-menu"} ref={root} onBlur={event => {
    if (open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
  }} onKeyDown={event => {
    if (!open || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
    trigger.current?.focus();
  }}>
    <button type="button" className="header-account-trigger" ref={trigger} aria-label={label} aria-controls={id} aria-expanded={open}
      onClick={() => {
        if (open) { close(); return; }
        onOpen?.();
        setDisclosure({ identity, open: true });
        if (user) void checkAccess();
      }}>
      <AccountAvatar photo={photo} name={name}/><span className="header-account-trigger-label">{staffActions && name ? name : label}</span><ChevronDown size={14} aria-hidden="true"/>
    </button>
    <div className="header-account-panel" id={id} hidden={!open} inert={!open}>
      {open && (user ? <>
        <div className="header-account-identity">
          <AccountAvatar photo={photo} name={name}/>
          <div><strong>{name || label}</strong>{email && email !== name && <small>{email}</small>}
            {(showStaff || showProfile || showSaved) && <div className="header-account-badges">
              {showStaff && role && <span>{t("Staff", "Nhân viên")} · {t(...roleNames[role])}</span>}
              {(showProfile || showSaved) && <span>{t("Customer", "Khách hàng")}</span>}
            </div>}
          </div>
        </div>
        <nav className="header-account-links" aria-label={t("Account destinations", "Điều hướng tài khoản")}>
          {showStaff && (staffActions
            ? <button type="button" onClick={() => { close(); staffActions.dashboard(); trigger.current?.focus({preventScroll:true}); }}><LayoutDashboard size={19} aria-hidden="true"/>{t("Staff Dashboard", "Bảng điều khiển nhân viên")}</button>
            : <a href={staffDashboard} aria-current={currentDestination(staffDashboard)} onClick={close}><LayoutDashboard size={19} aria-hidden="true"/>{t("Staff Dashboard", "Bảng điều khiển nhân viên")}</a>)}
          {showProfile && <Link href={staffActions ? CUSTOMER_ACCOUNT_URL : "/account"} aria-current={currentDestination(staffActions ? CUSTOMER_ACCOUNT_URL : "/account")} onClick={close}><House size={19} aria-hidden="true"/>{t("Customer Dashboard", "Bảng điều khiển khách hàng")}</Link>}
          {staffActions ? showStaff && <button type="button" onClick={() => { close(); staffActions.profile(); }}><UserRound size={19} aria-hidden="true"/>{t("My Staff Profile", "Hồ sơ nhân viên của tôi")}</button>
            : showProfile && <Link href="/account?tab=profile" aria-current={currentDestination("/account?tab=profile")} onClick={close}><UserRound size={19} aria-hidden="true"/>{t("My Profile", "Hồ sơ của tôi")}</Link>}
          {showSaved && <Link href="/saved" aria-current={currentDestination("/saved")} onClick={close}><Heart size={19} aria-hidden="true"/>{t("Saved Homes", "Nhà đã lưu")}</Link>}
        </nav>
        {staffAccessRevoked && <p className="header-account-message" role="status">{t("Your staff access was removed.", "Quyền truy cập nhân viên của bạn đã bị thu hồi.")}</p>}
        {checking ? <p className="header-account-message" role="status">{t("Checking portal access…", "Đang kiểm tra quyền truy cập cổng…")}</p>
          : canRetry ? <div className="header-account-message"><p role="status">{t("Some portal access couldn’t be verified.", "Chưa thể xác minh một số quyền truy cập.")}</p>
            <button type="button" className="text-link header-account-retry" onClick={() => void checkAccess()}>{t("Try again", "Thử lại")}</button></div>
          : !showStaff && !showProfile && !showSaved && <p className="header-account-message" role="status">{t("This account has no Gary Home portal access.", "Tài khoản này không có quyền truy cập cổng Gary Home.")}</p>}
        <div className="header-account-footer">
          <button type="button" className="header-account-signout" disabled={signingOut} aria-busy={signingOut} onClick={() => void signOut()}>
            <LogOut size={19} aria-hidden="true"/>{signingOut ? t("Signing out…", "Đang đăng xuất…") : t("Sign Out", "Đăng xuất")}
          </button>
          {signOutFailed && <p className="header-account-message" role="alert">{t("Couldn’t sign out. Try again.", "Chưa thể đăng xuất. Vui lòng thử lại.")}</p>}
        </div>
      </> : <>
        {sessionExpired && <p className="header-account-message" role="status">{t("Your session expired. Sign in again.", "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")}</p>}
        <nav className="header-account-links" aria-label={t("Sign-in portals", "Cổng đăng nhập")}>
          <Link href="/account" aria-current={currentDestination("/account")} onClick={close}><UserRound size={19} aria-hidden="true"/>{t("Customer Login", "Đăng nhập khách hàng")}</Link>
          <a href={staffDashboard} aria-current={currentDestination(staffDashboard)} onClick={close}><ShieldCheck size={19} aria-hidden="true"/>{t("Staff Login", "Đăng nhập nhân viên")}</a>
        </nav>
      </>)}
    </div>
  </div>;
}
