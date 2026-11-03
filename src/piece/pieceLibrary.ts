import type { PieceProgress, PieceSettings, StepProgress } from "./pieceProgress";

/** An imported piece, its phrase split, how it's practised and how far it has come. */
export interface PieceRecord {
  /** A hash of the MusicXML text, so importing the same file again finds its progress. */
  id: string;
  title: string;
  composer: string;
  fileName: string;
  xml: string;
  measureCount: number;
  addedAt: number;
  openedAt: number;
  /** Measure indices that start a phrase, after the first bar. */
  phraseStarts: number[];
  settings: PieceSettings;
  progress: PieceProgress;
  /** The intro section is unfolded. */
  introOpen?: boolean;
  /** Each intro card's drill, by feature id. */
  intros?: Record<string, StepProgress>;
  /** Before v0.1.74: the intro cards had been read or skipped. */
  introDone?: boolean;
}

export interface PieceLibrary {
  list(): Promise<PieceRecord[]>;
  get(id: string): Promise<PieceRecord | undefined>;
  put(record: PieceRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

const DB_NAME = "piano-mate-pieces";
const STORE = "pieces";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Pieces kept in this browser's IndexedDB: scores are too big for localStorage. */
class BrowserLibrary implements PieceLibrary {
  constructor(private readonly db: IDBDatabase) {}

  private store(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  async list(): Promise<PieceRecord[]> {
    const records = await request(this.store("readonly").getAll() as IDBRequest<PieceRecord[]>);
    return records.sort((a, b) => b.openedAt - a.openedAt);
  }

  get(id: string): Promise<PieceRecord | undefined> {
    return request(this.store("readonly").get(id) as IDBRequest<PieceRecord | undefined>);
  }

  async put(record: PieceRecord): Promise<void> {
    await request(this.store("readwrite").put(record));
  }

  async remove(id: string): Promise<void> {
    await request(this.store("readwrite").delete(id));
  }
}

/** For when IndexedDB is unavailable (some private windows): pieces last as long as the page. */
export class MemoryLibrary implements PieceLibrary {
  private readonly records = new Map<string, PieceRecord>();

  async list(): Promise<PieceRecord[]> {
    return [...this.records.values()].sort((a, b) => b.openedAt - a.openedAt);
  }

  async get(id: string): Promise<PieceRecord | undefined> {
    return this.records.get(id);
  }

  async put(record: PieceRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id);
  }
}

export async function openPieceLibrary(): Promise<{ library: PieceLibrary; persistent: boolean }> {
  try {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: "id" });
    return { library: new BrowserLibrary(await request(open)), persistent: true };
  } catch (error) {
    console.warn("Pieces can't be stored in this browser; they last until the page closes", error);
    return { library: new MemoryLibrary(), persistent: false };
  }
}

/**
 * A short id from the score's text. SHA-256 where the browser offers it; over plain http on
 * the LAN (no secure context) a 64-bit FNV-1a hash, which is plenty to tell pieces apart.
 */
export async function pieceId(xml: string): Promise<string> {
  const bytes = new TextEncoder().encode(xml);
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, "0");
}
