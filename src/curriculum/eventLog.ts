import type { PracticeEvent } from "./events";

/** Append-only storage for practice events. */
export interface EventLog {
  /** Where events end up: the Claude artifact's database, this browser, or nowhere (dev server). */
  readonly storage: "account" | "browser" | "none";
  load(): Promise<PracticeEvent[]>;
  append(event: PracticeEvent): Promise<void>;
}

// The slice of the artifact runtime's db and user capabilities this file uses.
interface DbDoc {
  set(data: Record<string, unknown>): Promise<void>;
}
interface DbSnapshot {
  data(): Record<string, unknown> | undefined;
}
interface DbQuery {
  where(field: string, op: string, value: unknown): DbQuery;
  orderBy(field: string, dir?: "asc" | "desc"): DbQuery;
  limit(n: number): DbQuery;
  get(): Promise<{ docs: DbSnapshot[] }>;
}
interface DbCollection extends DbQuery {
  doc(id?: string): DbDoc;
}
interface Db {
  collection(path: string): DbCollection;
}
interface ArtifactRuntime {
  use(name: "db"): Promise<Db | null>;
  use(name: "user"): Promise<{ id(): Promise<string | null> } | null>;
}

const CHUNK_KIND = "practice-events";
/** Documents hold at most 256 KiB; start a new chunk well before that. */
const CHUNK_MAX_CHARS = 150_000;
const PAGE_SIZE = 500;

interface Chunk {
  id: string;
  startedAt: number;
  events: PracticeEvent[];
}

/**
 * Events in the artifact's database, under the viewer's private `data/users/<id>` collection.
 * The database allows 25,000 documents per artifact, so events are packed into chunk
 * documents. Each page load writes only chunks it created, so two open tabs never overwrite
 * each other's events.
 */
export class DbEventLog implements EventLog {
  readonly storage = "account";
  private readonly collection: DbCollection;
  private current: Chunk | null = null;
  private readonly dirty = new Set<Chunk>();
  private flushing: Promise<void> | null = null;

  constructor(db: Db, userId: string) {
    this.collection = db.collection(`data/users/${userId}`);
  }

  async load(): Promise<PracticeEvent[]> {
    const events: PracticeEvent[] = [];
    let after = -1;
    for (;;) {
      const page = await this.collection
        .where("kind", "==", CHUNK_KIND)
        .where("startedAt", ">", after)
        .orderBy("startedAt")
        .limit(PAGE_SIZE)
        .get();
      for (const doc of page.docs) {
        const data = doc.data();
        if (Array.isArray(data?.events)) events.push(...(data.events as PracticeEvent[]));
        if (typeof data?.startedAt === "number") after = data.startedAt;
      }
      if (page.docs.length < PAGE_SIZE) break;
    }
    return events.sort((a, b) => a.at - b.at);
  }

  append(event: PracticeEvent): Promise<void> {
    if (!this.current || JSON.stringify(this.current.events).length > CHUNK_MAX_CHARS) {
      const startedAt = Date.now();
      this.current = { id: `events-${startedAt}-${Math.random().toString(36).slice(2, 8)}`, startedAt, events: [] };
    }
    this.current.events.push(event);
    this.dirty.add(this.current);
    return this.flush();
  }

  /** Writes changed chunks one at a time; appends during a write are picked up by the next pass. */
  private flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      let failures = 0;
      while (this.dirty.size > 0) {
        const [chunk] = this.dirty;
        this.dirty.delete(chunk);
        try {
          await this.collection.doc(chunk.id).set({
            kind: CHUNK_KIND,
            startedAt: chunk.startedAt,
            events: [...chunk.events],
          });
          failures = 0;
        } catch (error) {
          this.dirty.add(chunk);
          if (++failures >= 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 2000));
        }
      }
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }
}

const STORAGE_KEY = "piano-mate.events.v1";

/** Events in localStorage, for running outside the Claude artifact viewer. */
export class LocalEventLog implements EventLog {
  readonly storage = "browser";
  private events: PracticeEvent[] = [];

  async load(): Promise<PracticeEvent[]> {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      this.events = Array.isArray(stored) ? stored : [];
    } catch {
      this.events = [];
    }
    return [...this.events];
  }

  async append(event: PracticeEvent): Promise<void> {
    this.events.push(event);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.events));
  }
}

/** Keeps events for this page load only, so dev-server practice never mixes with real progress. */
export class MemoryEventLog implements EventLog {
  readonly storage = "none";

  async load(): Promise<PracticeEvent[]> {
    return [];
  }

  async append(): Promise<void> {}
}

/**
 * Nothing is stored on the dev server. Otherwise the artifact database when this page runs in
 * the Claude viewer and the viewer is signed in, else this browser.
 */
export async function openEventLog(): Promise<EventLog> {
  if (import.meta.env.DEV) return new MemoryEventLog();
  const runtime = (window as unknown as { claude?: ArtifactRuntime }).claude;
  if (runtime?.use) {
    try {
      const [db, user] = await Promise.all([runtime.use("db"), runtime.use("user")]);
      const userId = await user?.id();
      if (db && userId) return new DbEventLog(db, userId);
    } catch (error) {
      console.warn("Artifact storage unavailable; keeping progress in this browser.", error);
    }
  }
  return new LocalEventLog();
}
