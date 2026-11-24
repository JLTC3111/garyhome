import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { request } from "./requests.ts";
import { isStaffRole, type StaffRole } from "./staff.ts";

export type SessionPhase = "checking" | "ready" | "recovering" | "offline" | "error";
export type SessionState = { user: User | null; editor: boolean; role: StaffRole | null; resolved: boolean; phase: SessionPhase; generation: number; expired: boolean; staffRevoked: boolean };
type Dependencies = {
  getSession: () => PromiseLike<{ data: { session: Session | null }; error: unknown }>;
  getRole: (userId: string, signal: AbortSignal) => PromiseLike<string | null>;
  onChange: (state: SessionState) => void;
  online: () => boolean;
  timeoutMs?: number;
};

function sessionEnded(error: unknown) {
  const issue = error as { name?: string; code?: string };
  return issue.name === "AuthSessionMissingError" ||
    ["session_expired", "session_not_found", "refresh_token_not_found", "refresh_token_already_used"].includes(issue.code ?? "");
}

export class SessionRecovery {
  state: SessionState = { user: null, editor: false, role: null, resolved: false, phase: "checking", generation: 0, expired: false, staffRevoked: false };
  private stopped = false;
  private recovery: Promise<boolean> | null = null;
  private storageRevision = 0;
  private storageRecovery: Promise<boolean> | null = null;
  private role: { generation: number; storageRevision: number; promise: Promise<boolean> } | null = null;
  private scheduled: ReturnType<typeof setTimeout> | undefined;
  private accessToken: string | null = null;

  private deps: Dependencies;
  constructor(deps: Dependencies) { this.deps = deps; }

  private publish(next: Partial<SessionState>) {
    if (this.stopped) return;
    this.state = { ...this.state, ...next };
    this.deps.onChange(this.state);
  }

  private clearSession(expired = false) {
    clearTimeout(this.scheduled);
    this.recovery = null;
    this.role = null;
    this.accessToken = null;
    this.publish({ user: null, editor: false, role: null, resolved: true, phase: "ready", generation: this.state.generation + 1, expired, staffRevoked: false });
  }

  // Called synchronously by onAuthStateChange. No SDK calls or awaited work here.
  observe(session: Session | null, event?: AuthChangeEvent) {
    if (this.stopped) return;
    if (!session) { this.clearSession(); return; }
    const changed = session.user.id !== this.state.user?.id;
    if (event === "SIGNED_IN" && !changed && this.state.phase === "ready" && this.accessToken === session.access_token) return;
    this.accessToken = session.access_token;
    this.publish({ user: session.user, ...(changed ? { editor: false, role: null, resolved: false, phase: "recovering", generation: this.state.generation + 1, expired: false, staffRevoked: false } : {}) });
    clearTimeout(this.scheduled);
    // The active session read checks the current identity's role after the SDK
    // emits a token refresh. A genuinely new identity still gets its own check.
    if (this.recovery && !changed) return;
    this.scheduled = setTimeout(() => { void this.checkRole(); }, 0);
  }

  offline() { this.publish({ phase: "offline" }); }

  private checkRole(): Promise<boolean> {
    clearTimeout(this.scheduled);
    const { user, generation } = this.state;
    const storageRevision = this.storageRevision;
    if (!user || this.stopped) return Promise.resolve(false);
    if (!this.deps.online()) { this.offline(); return Promise.resolve(false); }
    if (this.role?.generation === generation && this.role.storageRevision === storageRevision) return this.role.promise;
    const promise = Promise.resolve().then(async () => {
      try {
        const role = await request(signal => this.deps.getRole(user.id, signal), this.deps.timeoutMs ?? 12000);
        if (this.stopped || this.state.generation !== generation || this.storageRevision !== storageRevision) return false;
        const editor = isStaffRole(role);
        const staffRevoked = !editor && (this.state.editor || this.state.staffRevoked);
        this.publish({ editor, role: editor ? role : null, resolved: true, phase: "ready", staffRevoked });
        return editor;
      } catch {
        if (!this.stopped && this.state.generation === generation && this.storageRevision === storageRevision) this.publish({ phase: this.deps.online() ? "error" : "offline" });
        // Preserve an already verified user's workspace during transient failure.
        // Mutations still require a successful fresh recovery, and RLS remains authoritative.
        return false;
      } finally { if (this.role?.promise === promise) this.role = null; }
    });
    this.role = { generation, storageRevision, promise };
    return promise;
  }

  recover(reason: "check" | "storage-change" = "check"): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    if (reason === "storage-change") this.storageRevision++;
    if (!this.deps.online()) { this.offline(); return Promise.resolve(false); }
    if (this.recovery) {
      if (reason === "check") return this.recovery;
      // An older read cannot stand in for a change to the shared session.
      this.storageRecovery ??= this.recovery.then(() => {
        this.storageRecovery = null;
        return this.recover("storage-change");
      });
      return this.storageRecovery;
    }
    const { generation, resolved } = this.state;
    const accessToken = this.accessToken;
    const storageRevision = this.storageRevision;
    // A known workspace stays active while the browser revalidates its session.
    if (!resolved) this.publish({ phase: this.state.user ? "recovering" : "checking" });
    const promise = Promise.resolve().then(async () => {
      try {
        const { data, error } = await request(() => this.deps.getSession(), this.deps.timeoutMs ?? 12000);
        if (this.stopped || this.storageRevision !== storageRevision) return false;
        const expired = !!error && sessionEnded(error);
        if (generation !== this.state.generation || accessToken !== this.accessToken) {
          // The SDK can emit SIGNED_OUT while processing an expired refresh token.
          if (expired && !this.state.user && this.state.generation === generation + 1) this.publish({ expired: true });
          // Auth events are newer than the session read. Never restore an old identity.
          return this.state.user ? this.checkRole() : false;
        }
        if (error && !expired) throw error;
        if (expired || !data.session) {
          this.clearSession(expired || this.state.expired || (reason !== "storage-change" && !!this.state.user));
          return false;
        }
        this.observe(data.session);
        return await this.checkRole();
      } catch {
        if (!this.stopped && generation === this.state.generation && accessToken === this.accessToken && this.storageRevision === storageRevision) {
          this.publish({ phase: this.deps.online() ? "error" : "offline" });
        }
        return false;
      } finally { if (this.recovery === promise) this.recovery = null; }
    });
    this.recovery = promise;
    return promise;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.scheduled);
  }
}
