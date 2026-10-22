import type { Session, User } from "@supabase/supabase-js";
import { request } from "./requests.ts";
import { isStaffRole, type StaffRole } from "./staff.ts";

export type SessionPhase = "checking" | "ready" | "recovering" | "offline" | "error";
export type SessionState = { user: User | null; editor: boolean; role: StaffRole | null; phase: SessionPhase; generation: number };
type Dependencies = {
  getSession: () => PromiseLike<{ data: { session: Session | null }; error: unknown }>;
  getRole: (userId: string, signal: AbortSignal) => PromiseLike<string | null>;
  onChange: (state: SessionState) => void;
  online: () => boolean;
  timeoutMs?: number;
};

export class SessionRecovery {
  state: SessionState = { user: null, editor: false, role: null, phase: "checking", generation: 0 };
  private stopped = false;
  private recovery: Promise<boolean> | null = null;
  private role: { generation: number; promise: Promise<boolean> } | null = null;
  private scheduled: ReturnType<typeof setTimeout> | undefined;

  private deps: Dependencies;
  constructor(deps: Dependencies) { this.deps = deps; }

  private publish(next: Partial<SessionState>) {
    if (this.stopped) return;
    this.state = { ...this.state, ...next };
    this.deps.onChange(this.state);
  }

  // Called synchronously by onAuthStateChange. No SDK calls or awaited work here.
  observe(session: Session | null) {
    if (this.stopped) return;
    if (!session) {
      clearTimeout(this.scheduled);
      this.recovery = null;
      this.role = null;
      this.publish({ user: null, editor: false, role: null, phase: "ready", generation: this.state.generation + 1 });
      return;
    }
    const changed = session.user.id !== this.state.user?.id;
    this.publish({ user: session.user, ...(changed ? { editor: false, role: null, phase: "recovering", generation: this.state.generation + 1 } : {}) });
    clearTimeout(this.scheduled);
    this.scheduled = setTimeout(() => { void this.checkRole(); }, 0);
  }

  offline() { this.publish({ phase: "offline" }); }

  private checkRole(): Promise<boolean> {
    const { user, generation } = this.state;
    if (!user || this.stopped) return Promise.resolve(false);
    if (!this.deps.online()) { this.offline(); return Promise.resolve(false); }
    if (this.role?.generation === generation) return this.role.promise;
    const promise = Promise.resolve().then(async () => {
      try {
        const role = await request(signal => this.deps.getRole(user.id, signal), this.deps.timeoutMs ?? 12000);
        if (this.stopped || this.state.generation !== generation) return false;
        const editor = isStaffRole(role);
        this.publish({ editor, role: editor ? role : null, phase: "ready" });
        return editor;
      } catch {
        if (!this.stopped && this.state.generation === generation) this.publish({ phase: this.deps.online() ? "error" : "offline" });
        // Preserve an already verified user's workspace during transient failure.
        // Mutations still require a successful fresh recovery, and RLS remains authoritative.
        return false;
      } finally { if (this.role?.promise === promise) this.role = null; }
    });
    this.role = { generation, promise };
    return promise;
  }

  recover(): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    if (!this.deps.online()) { this.offline(); return Promise.resolve(false); }
    if (this.recovery) return this.recovery;
    const generation = this.state.generation;
    this.publish({ phase: this.state.user ? "recovering" : "checking" });
    const promise = Promise.resolve().then(async () => {
      try {
        const { data, error } = await request(() => this.deps.getSession(), this.deps.timeoutMs ?? 12000);
        if (this.stopped) return false;
        if (generation !== this.state.generation) {
          // Auth events are newer than the session read. Never restore an old identity.
          return this.state.user ? this.checkRole() : false;
        }
        if (error) throw error;
        if (!data.session) { this.observe(null); return false; }
        this.observe(data.session);
        clearTimeout(this.scheduled);
        return await this.checkRole();
      } catch {
        if (!this.stopped && generation === this.state.generation) this.publish({ phase: this.deps.online() ? "error" : "offline" });
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
