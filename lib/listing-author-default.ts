import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListingAuthor } from "./types";
import type { StaffProfile } from "./staff";

export const CURRENT_STAFF_AUTHOR = "current-staff";

function linkedAuthor(authors: ListingAuthor[], userId: string) {
  return authors.filter(author => author.staff_user_id === userId)
    .sort((a, b) => Number(b.published) - Number(a.published) || a.sort_order - b.sort_order || a.id.localeCompare(b.id))[0];
}

export function defaultListingAuthorId(authors: ListingAuthor[], userId?: string | null): string | null {
  return userId ? linkedAuthor(authors, userId)?.id || CURRENT_STAFF_AUTHOR : null;
}

type EditorTask = <T>(operation: (db: SupabaseClient, signal: AbortSignal) => PromiseLike<T>) => Promise<T>;

// Resolve the editor's automatic choice only when saving, so opening or cancelling
// a draft never creates a public profile. Explicit profile/company choices pass through.
export async function resolveListingAuthor({ authorId, authors, user, staffProfile, demo, editorTask }: {
  authorId?: string | null; authors: ListingAuthor[]; user: { id: string } | null;
  staffProfile: Pick<StaffProfile, "display_name"> | null; demo: boolean; editorTask: EditorTask;
}): Promise<{ authorId: string | null; author?: ListingAuthor }> {
  if (authorId !== CURRENT_STAFF_AUTHOR) return { authorId: authorId || null };
  if (!user) throw new Error("Sign in again to assign yourself as the listing author. Your draft is still open.");
  const userId = user.id, local = linkedAuthor(authors, userId);
  if (local) return { authorId: local.id, author: local };

  async function existing() {
    const result = await editorTask((db, signal) => db.from("listing_authors").select("*")
      .eq("staff_user_id", userId).order("published", { ascending: false }).order("sort_order", { ascending: true })
      .limit(1).abortSignal(signal).maybeSingle());
    if (result.error) throw new Error("Couldn’t load your listing profile. Reconnect and save again. Your draft is still open.");
    return result.data as ListingAuthor | null;
  }
  if (!demo) {
    const saved = await existing();
    if (saved) return { authorId: saved.id, author: saved };
  }

  let displayName = staffProfile?.display_name.trim() || "";
  if (!displayName && !demo) {
    const profile = await editorTask((db, signal) => db.rpc("get_staff_profile").abortSignal(signal));
    if (profile.error || !profile.data || typeof profile.data.display_name !== "string") throw new Error("Couldn’t load your listing profile. Reconnect and save again. Your draft is still open.");
    displayName = profile.data.display_name.trim();
  }
  const author: ListingAuthor = {
    // A deterministic ID lets concurrent tabs recover the same new profile
    // without adding a unique constraint to existing staff/profile links.
    id: userId, slug: `staff-${userId}`, staff_user_id: userId,
    display_name: (displayName || "Gary Home staff").slice(0, 120),
    bio_en: "", bio_vi: "", portrait_url: "", phone: "", whatsapp_phone: "", zalo_phone: "", email: "",
    // Existing staff accounts, including bootstrap owners, may have no name.
    // Keep the staff link without publishing a login email as their name.
    is_placeholder: !displayName, published: true, sort_order: 0, updated_at: new Date().toISOString(),
  };
  if (demo) return { authorId: author.id, author };
  const result = await editorTask((db, signal) => db.from("listing_authors").insert(author).select("*").abortSignal(signal).single());
  if (result.error || !result.data) {
    if (result.error?.code === "23505") {
      const saved = await existing();
      if (saved) return { authorId: saved.id, author: saved };
    }
    throw new Error("Couldn’t assign your listing profile. Reconnect and save again. Your draft is still open.");
  }
  const saved = result.data as ListingAuthor;
  return { authorId: saved.id, author: saved };
}
