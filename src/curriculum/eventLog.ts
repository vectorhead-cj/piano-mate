import type { SupabaseClient } from "@supabase/supabase-js";
import { currentUser, supabase } from "../account";
import type { PracticeEvent } from "./events";

export type EventType = PracticeEvent["type"];

/**
 * Which events to load: those of these types. Loading only what a screen needs keeps startup
 * quick however much of other kinds of practice the log holds.
 */
export interface EventQuery<T extends EventType = EventType> {
  types: readonly T[];
}

/** Append-only storage for practice events. */
export interface EventLog {
  /** Where events end up: the player's account, this browser, or nowhere (dev server). */
  readonly storage: "account" | "browser" | "none";
  load<T extends EventType>(query: EventQuery<T>): Promise<Extract<PracticeEvent, { type: T }>[]>;
  append(event: PracticeEvent): Promise<void>;
}

function matches(event: PracticeEvent, query: EventQuery): boolean {
  return query.types.includes(event.type);
}

const TABLE = "practice_events";
/** The Data API returns at most this many rows per request (max_rows in supabase/config.toml). */
const PAGE_SIZE = 1000;
const UPLOAD_BATCH = 500;

function row(userId: string, event: PracticeEvent) {
  return { user_id: userId, id: event.id, type: event.type, at: new Date(event.at).toISOString(), event };
}

/**
 * Events in the player's Supabase account, one row per event (see supabase/migrations). Inserts
 * skip ids already stored, so a retried write never adds an event twice.
 */
export class AccountEventLog implements EventLog {
  readonly storage = "account";

  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: string,
  ) {}

  async load<T extends EventType>(query: EventQuery<T>): Promise<Extract<PracticeEvent, { type: T }>[]> {
    await this.adoptBrowserEvents();
    const events: Extract<PracticeEvent, { type: T }>[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      // The (user_id, type, at) index serves this.
      const { data, error } = await this.client
        .from(TABLE)
        .select("event")
        .in("type", [...query.types])
        .order("at")
        .order("id")
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      for (const { event } of data) events.push(event as Extract<PracticeEvent, { type: T }>);
      if (data.length < PAGE_SIZE) break;
    }
    return events;
  }

  async append(event: PracticeEvent): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.insert([event]);
        return;
      } catch (error) {
        if (attempt >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 2000));
      }
    }
  }

  private adopted = false;

  /** Practice from before signing in in this browser moves into the account. */
  private async adoptBrowserEvents(): Promise<void> {
    if (this.adopted) return;
    const events = readBrowserEvents();
    for (let i = 0; i < events.length; i += UPLOAD_BATCH) await this.insert(events.slice(i, i + UPLOAD_BATCH));
    if (events.length > 0) localStorage.removeItem(STORAGE_KEY);
    this.adopted = true;
  }

  private async insert(events: PracticeEvent[]): Promise<void> {
    const { error } = await this.client
      .from(TABLE)
      .upsert(
        events.map((event) => row(this.userId, event)),
        { onConflict: "user_id,id", ignoreDuplicates: true },
      );
    if (error) throw error;
  }
}

const STORAGE_KEY = "piano-mate.events.v1";

function readBrowserEvents(): PracticeEvent[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

/** Events in localStorage, while signed out. */
export class LocalEventLog implements EventLog {
  readonly storage = "browser";

  async load<T extends EventType>(query: EventQuery<T>): Promise<Extract<PracticeEvent, { type: T }>[]> {
    return readBrowserEvents().filter((event): event is Extract<PracticeEvent, { type: T }> => matches(event, query));
  }

  async append(event: PracticeEvent): Promise<void> {
    // Read afresh: another screen may have appended since.
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...readBrowserEvents(), event]));
  }
}

/** Keeps events for this page load only, so dev-server practice never mixes with real progress. */
export class MemoryEventLog implements EventLog {
  readonly storage = "none";
  private readonly events: PracticeEvent[] = [];

  async load<T extends EventType>(query: EventQuery<T>): Promise<Extract<PracticeEvent, { type: T }>[]> {
    return this.events.filter((event): event is Extract<PracticeEvent, { type: T }> => matches(event, query));
  }

  async append(event: PracticeEvent): Promise<void> {
    this.events.push(event);
  }
}

/**
 * The signed-in player's account, else this browser. Nothing is stored on the dev server
 * unless the URL has ?account, which uses the account there too.
 */
export async function openEventLog(): Promise<EventLog> {
  const dev = import.meta.env.DEV;
  if (dev && !new URLSearchParams(location.search).has("account")) return new MemoryEventLog();
  try {
    const user = await currentUser();
    if (user) return new AccountEventLog(await supabase(), user.id);
  } catch (error) {
    console.warn("Account unavailable; keeping progress in this browser.", error);
  }
  return dev ? new MemoryEventLog() : new LocalEventLog();
}
