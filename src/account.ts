import type { SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://nnzrjghjldllddnbynmz.supabase.co";
/** Meant to be public. Row-level security in supabase/migrations keeps each player's data their own. */
const SUPABASE_KEY = "sb_publishable_jtsCazGpjGC4nt9O50rtGA_KbD53nz7";

export interface AccountUser {
  id: string;
  email: string | null;
}

let client: Promise<SupabaseClient> | null = null;

/**
 * The Supabase client, loaded on first use so it stays out of the first paint. It keeps the
 * session in localStorage and refreshes it, so a player signs in once per browser.
 */
export function supabase(): Promise<SupabaseClient> {
  client ??= import("@supabase/supabase-js").then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_KEY));
  return client;
}

/** The signed-in player, from the session this browser keeps; null when signed out. */
export async function currentUser(): Promise<AccountUser | null> {
  const { data, error } = await (await supabase()).auth.getSession();
  if (error) throw error;
  const user = data.session?.user;
  return user ? { id: user.id, email: user.email ?? null } : null;
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await (await supabase()).auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await (await supabase()).auth.signOut();
  if (error) throw error;
}
