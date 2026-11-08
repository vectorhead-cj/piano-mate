import type { SupabaseClient } from "@supabase/supabase-js";
import { currentUser, supabase } from "../account";
import { newId } from "../curriculum/events";
import { defaultSettings, normalizeSettings, type PieceSettings } from "./pieceProgress";

/**
 * An imported piece as it stands now: the fold of its events (applyPieceEvent here, and
 * apply_piece_event in supabase/migrations, which must agree). Its practice is not in here: that
 * is piece-pass events in the practice log.
 */
export interface PieceRecord {
  /** Made when the piece is imported; it stays the piece's whatever score it later points at. */
  id: string;
  title: string;
  composer: string;
  fileName: string;
  /** Hash of the score's MusicXML text: importing the same file again finds the piece. */
  scoreHash: string;
  /** Where the score file is kept (in the account: the `scores` bucket). */
  scorePath: string;
  measureCount: number;
  /** Measure indices that start a phrase, after the first bar. */
  phraseStarts: number[];
  settings: PieceSettings;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

interface PieceEventBase {
  v: 1;
  id: string;
  /** Epoch ms. */
  at: number;
  pieceId: string;
}

export type PieceEvent =
  | (PieceEventBase & {
      type: "piece-imported";
      title: string;
      composer: string;
      fileName: string;
      scoreHash: string;
      scorePath: string;
      measureCount: number;
      phraseStarts: number[];
      settings: PieceSettings;
    })
  | (PieceEventBase & { type: "piece-renamed"; title: string; composer?: string })
  | (PieceEventBase & { type: "phrases-changed"; phraseStarts: number[] })
  | (PieceEventBase & { type: "settings-changed"; settings: PieceSettings })
  | (PieceEventBase & { type: "score-replaced"; scoreHash: string; scorePath: string; measureCount: number; fileName?: string })
  | (PieceEventBase & { type: "piece-archived" });

/** Everything but what makes each event itself; the library fills those in. */
export type PieceChange = PieceEvent extends infer E ? (E extends PieceEvent ? Omit<E, "v" | "id" | "at" | "pieceId"> : never) : never;

/** A piece after one more event. Mirrors apply_piece_event: an event on no piece, or an archived one, is refused. */
export function applyPieceEvent(record: PieceRecord | undefined, event: PieceEvent): PieceRecord {
  if (event.type === "piece-imported") {
    if (record) throw new Error(`Piece ${event.pieceId} already exists`);
    const { title, composer, fileName, scoreHash, scorePath, measureCount, phraseStarts, settings } = event;
    return { id: event.pieceId, title, composer, fileName, scoreHash, scorePath, measureCount, phraseStarts, settings: normalizeSettings(settings), createdAt: event.at, updatedAt: event.at };
  }
  if (!record || record.archivedAt !== undefined) throw new Error(`No such piece: ${event.pieceId}`);
  const next = { ...record, updatedAt: Math.max(record.updatedAt, event.at) };
  switch (event.type) {
    case "piece-renamed":
      return { ...next, title: event.title, composer: event.composer ?? record.composer };
    case "phrases-changed":
      return { ...next, phraseStarts: event.phraseStarts };
    case "settings-changed":
      return { ...next, settings: normalizeSettings(event.settings) };
    case "score-replaced":
      return { ...next, scoreHash: event.scoreHash, scorePath: event.scorePath, measureCount: event.measureCount, fileName: event.fileName ?? record.fileName };
    case "piece-archived":
      return { ...next, archivedAt: event.at };
  }
}

/** What an import knows of the file it read. */
export interface ScoreImport {
  xml: string;
  fileName: string;
  title: string;
  composer: string;
  measureCount: number;
  tempo?: number;
}

export interface PieceLibrary {
  /** Where pieces are kept: the player's account, or this page only (dev server). */
  readonly storage: "account" | "none";
  /** The pieces not archived. */
  list(): Promise<PieceRecord[]>;
  /** The score's MusicXML. */
  score(record: PieceRecord): Promise<string>;
  /** Adds the score as a new piece, or finds the piece already made from it. */
  import(score: ScoreImport): Promise<{ record: PieceRecord; existed: boolean }>;
  /** Records a change to a piece; resolves to the piece as it now is. Changes are written in order. */
  change(record: PieceRecord, change: PieceChange): Promise<PieceRecord>;
}

function eventFor(pieceId: string, change: PieceChange): PieceEvent {
  return { ...change, v: 1, id: newId(), at: Date.now(), pieceId } as PieceEvent;
}

function importedEvent(pieceId: string, score: ScoreImport, scoreHash: string, scorePath: string): PieceEvent {
  return eventFor(pieceId, {
    type: "piece-imported",
    title: score.title,
    composer: score.composer,
    fileName: score.fileName,
    scoreHash,
    scorePath,
    measureCount: score.measureCount,
    phraseStarts: [],
    settings: defaultSettings(score.tempo),
  });
}

interface PieceRow {
  id: string;
  title: string;
  composer: string;
  file_name: string;
  score_hash: string;
  score_path: string;
  measure_count: number;
  phrase_starts: number[];
  settings: Partial<PieceSettings>;
  created_at: string;
  updated_at: string;
}

function fromRow(row: PieceRow): PieceRecord {
  return {
    id: row.id,
    title: row.title,
    composer: row.composer,
    fileName: row.file_name,
    scoreHash: row.score_hash,
    scorePath: row.score_path,
    measureCount: row.measure_count,
    phraseStarts: row.phrase_starts,
    // Settings added later fall back to their defaults.
    settings: normalizeSettings(row.settings),
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  };
}

const ATTEMPTS = 3;

async function retried<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= ATTEMPTS || (error as { final?: boolean }).final) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 2000));
    }
  }
}

/**
 * Pieces in the player's Supabase account (see supabase/migrations): the score file in the
 * `scores` bucket, written once under its hash, and the piece as `piece_events`, which the
 * database folds into the `pieces` row this reads.
 */
export class AccountPieceLibrary implements PieceLibrary {
  readonly storage = "account";
  private readonly scores = new Map<string, Promise<string>>();
  /** Changes go out one at a time, so the database folds them in the order they were made. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: string,
  ) {}

  async list(): Promise<PieceRecord[]> {
    const { data, error } = await this.client.from("pieces").select("*").is("archived_at", null).order("updated_at", { ascending: false });
    if (error) throw error;
    return (data as PieceRow[]).map(fromRow);
  }

  score(record: PieceRecord): Promise<string> {
    let xml = this.scores.get(record.scorePath);
    if (!xml) {
      xml = (async () => {
        const { data, error } = await this.client.storage.from("scores").download(record.scorePath);
        if (error) throw error;
        return gunzip(data);
      })();
      xml.catch(() => this.scores.delete(record.scorePath));
      this.scores.set(record.scorePath, xml);
    }
    return xml;
  }

  async import(score: ScoreImport): Promise<{ record: PieceRecord; existed: boolean }> {
    const hash = await scoreHash(score.xml);
    const existing = await this.findByScore(hash);
    if (existing) return { record: existing, existed: true };
    const path = `${this.userId}/${hash}.musicxml.gz`;
    await retried(() => this.upload(path, score.xml));
    this.scores.set(path, Promise.resolve(score.xml));
    const event = importedEvent(newUuid(), score, hash, path);
    try {
      await this.enqueue(event);
    } catch (error) {
      // The same score imported a moment ago (another tab): that's the piece.
      const raced = (error as { code?: string }).code === "23505" ? await this.findByScore(hash) : undefined;
      if (raced) return { record: raced, existed: true };
      throw error;
    }
    return { record: applyPieceEvent(undefined, event), existed: false };
  }

  async change(record: PieceRecord, change: PieceChange): Promise<PieceRecord> {
    const event = eventFor(record.id, change);
    const next = applyPieceEvent(record, event);
    await this.enqueue(event);
    return next;
  }

  private async findByScore(hash: string): Promise<PieceRecord | undefined> {
    const { data, error } = await this.client.from("pieces").select("*").eq("score_hash", hash).is("archived_at", null).maybeSingle();
    if (error) throw error;
    return data ? fromRow(data as PieceRow) : undefined;
  }

  private async upload(path: string, xml: string): Promise<void> {
    const { error } = await this.client.storage.from("scores").upload(path, await gzip(xml), { contentType: "application/gzip", upsert: false });
    // Already there: the same score, so the same bytes.
    if (error && !/exists|duplicate/i.test(error.message) && (error as { statusCode?: string }).statusCode !== "409") throw error;
  }

  private enqueue(event: PieceEvent): Promise<void> {
    const write = this.queue.catch(() => undefined).then(() => retried(() => this.insert(event)));
    this.queue = write;
    return write;
  }

  private async insert(event: PieceEvent): Promise<void> {
    const { error } = await this.client.from("piece_events").upsert(
      { user_id: this.userId, piece_id: event.pieceId, id: event.id, type: event.type, at: new Date(event.at).toISOString(), event },
      { onConflict: "user_id,id", ignoreDuplicates: true },
    );
    // A refused event (a constraint, or not the player's to write) won't be accepted by trying again.
    if (error) throw Object.assign(new Error(error.message), { code: error.code, final: /^(23|42)/.test(error.code ?? "") });
  }
}

/** Pieces for this page load only: the dev server, which keeps nothing. */
export class MemoryPieceLibrary implements PieceLibrary {
  readonly storage = "none";
  private readonly records = new Map<string, PieceRecord>();
  private readonly scores = new Map<string, string>();

  async list(): Promise<PieceRecord[]> {
    return [...this.records.values()].filter((r) => r.archivedAt === undefined).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async score(record: PieceRecord): Promise<string> {
    const xml = this.scores.get(record.scorePath);
    if (xml === undefined) throw new Error(`No score at ${record.scorePath}`);
    return xml;
  }

  async import(score: ScoreImport): Promise<{ record: PieceRecord; existed: boolean }> {
    const hash = await scoreHash(score.xml);
    const existing = (await this.list()).find((r) => r.scoreHash === hash);
    if (existing) return { record: existing, existed: true };
    const path = `memory/${hash}.musicxml.gz`;
    this.scores.set(path, score.xml);
    const event = importedEvent(newUuid(), score, hash, path);
    const record = applyPieceEvent(undefined, event);
    this.records.set(record.id, record);
    return { record, existed: false };
  }

  async change(record: PieceRecord, change: PieceChange): Promise<PieceRecord> {
    const next = applyPieceEvent(this.records.get(record.id), eventFor(record.id, change));
    this.records.set(next.id, next);
    return next;
  }
}

/**
 * The signed-in player's pieces; null when signed out, since pieces need an account. The dev
 * server keeps them for the page only, unless the URL has ?account.
 */
export async function openPieceLibrary(): Promise<PieceLibrary | null> {
  const dev = import.meta.env.DEV;
  if (dev && !new URLSearchParams(location.search).has("account")) return new MemoryPieceLibrary();
  const user = await currentUser();
  if (user) return new AccountPieceLibrary(await supabase(), user.id);
  return dev ? new MemoryPieceLibrary() : null;
}

/**
 * A short id from the score's text. SHA-256 where the browser offers it; over plain http on
 * the LAN (no secure context) a 64-bit FNV-1a hash, which is plenty to tell pieces apart.
 */
export async function scoreHash(xml: string): Promise<string> {
  const bytes = new TextEncoder().encode(xml);
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, "0");
}

/** A random (v4) UUID; crypto.randomUUID needs a secure context, getRandomValues doesn't. */
export function newUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function gzip(text: string): Promise<Blob> {
  const zipped = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  return new Blob([zipped], { type: "application/gzip" });
}

export async function gunzip(blob: Blob): Promise<string> {
  return new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

/**
 * What only this device remembers of a piece: when it was last opened here (for the library's
 * order) and whether its intro section is unfolded. Not worth syncing; lost with site data.
 */
const DEVICE_KEY = "piano-mate.pieces.device.v1";

interface DeviceState {
  openedAt?: number;
  introOpen?: boolean;
}

function readDevice(): Record<string, DeviceState> {
  try {
    const stored = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? "{}");
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

export function deviceState(pieceId: string): DeviceState {
  return readDevice()[pieceId] ?? {};
}

export function setDeviceState(pieceId: string, patch: DeviceState): void {
  try {
    const all = readDevice();
    all[pieceId] = { ...all[pieceId], ...patch };
    localStorage.setItem(DEVICE_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable: it lasts for this page.
  }
}
