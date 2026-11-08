import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { PiecePass } from "../src/curriculum/events";
import { AccountPieceLibrary, applyPieceEvent, gunzip, gzip, MemoryPieceLibrary, newUuid, type PieceEvent, type ScoreImport } from "../src/piece/pieceLibrary";
import { defaultSettings, projectPieceProgress, stepProgress } from "../src/piece/pieceProgress";

const score = (xml: string): ScoreImport => ({ xml, fileName: "minuet.musicxml", title: "Minuet", composer: "Bach", measureCount: 16, tempo: 96 });

let clock = 0;
function pass(place: PiecePass["place"], clean: boolean, streak = 3, misses = 0): PiecePass {
  return { type: "piece-pass", v: 1, id: `p${clock}`, at: ++clock, startedAt: clock, session: "s", pieceId: "piece", scoreHash: "h", place, tempo: 80, streak, misses, clean, notes: [] };
}

const leftSlow = { kind: "phrase", from: 0, to: 3, hand: "left", speed: "slow" } as const;

describe("projectPieceProgress", () => {
  it("passes a step on a streak, under the rule each pass was played to", () => {
    const { progress } = projectPieceProgress([pass(leftSlow, true), pass(leftSlow, true), pass(leftSlow, true)]);
    const step = stepProgress(progress, { from: 0, to: 3 }, { hand: "left", speed: "slow" })!;
    expect(step.attempts).toBe(3);
    expect(step.passedAt).toBeDefined();
    // A longer streak asked for later doesn't take back what was passed.
    const later = projectPieceProgress([pass(leftSlow, true, 1), pass(leftSlow, false, 10)]).progress;
    expect(stepProgress(later, { from: 0, to: 3 }, { hand: "left", speed: "slow" })!.passedAt).toBeDefined();
  });

  it("leaves focus drills out of the step they're picked from", () => {
    const focus = { kind: "focus", bars: { from: 0, to: 3 }, hand: "left", speed: "slow", beats: { from: 2, to: 5.5 } } as const;
    const { progress } = projectPieceProgress([pass(focus, true, 1), pass(focus, true, 1)]);
    expect(stepProgress(progress, { from: 0, to: 3 }, { hand: "left", speed: "slow" })).toBeUndefined();
  });

  it("keeps progress by bars, intros by feature, and the full piece apart", () => {
    const { progress, intros } = projectPieceProgress([pass(leftSlow, true, 1), pass({ kind: "intro", feature: "ties" }, true, 1), pass({ kind: "full" }, false, 1)]);
    // Another phrase over other bars has none of it.
    expect(stepProgress(progress, { from: 0, to: 1 }, { hand: "left", speed: "slow" })).toBeUndefined();
    expect(intros.ties.passedAt).toBeDefined();
    expect(progress.full).toMatchObject({ attempts: 1, recent: [false] });
  });

  it("folds passes in time order however they arrive", () => {
    const first = pass(leftSlow, false, 2);
    const second = pass(leftSlow, true, 2);
    const third = pass(leftSlow, true, 2);
    const step = stepProgress(projectPieceProgress([third, first, second]).progress, { from: 0, to: 3 }, { hand: "left", speed: "slow" })!;
    expect(step.recent).toEqual([false, true, true]);
  });
});

describe("applyPieceEvent", () => {
  const imported: PieceEvent = {
    type: "piece-imported", v: 1, id: "e1", at: 10, pieceId: "p", title: "Minuet", composer: "", fileName: "m.xml",
    scoreHash: "h", scorePath: "u/h.musicxml.gz", measureCount: 8, phraseStarts: [], settings: defaultSettings(),
  };

  it("folds a piece from its events", () => {
    let record = applyPieceEvent(undefined, imported);
    record = applyPieceEvent(record, { type: "phrases-changed", v: 1, id: "e2", at: 20, pieceId: "p", phraseStarts: [4] });
    record = applyPieceEvent(record, { type: "settings-changed", v: 1, id: "e3", at: 30, pieceId: "p", settings: { ...defaultSettings(), tempo: 72 } });
    expect(record).toMatchObject({ id: "p", phraseStarts: [4], createdAt: 10, updatedAt: 30 });
    expect(record.settings.tempo).toBe(72);
  });

  it("refuses events on no piece, an archived one, or a second import", () => {
    const archived = applyPieceEvent(applyPieceEvent(undefined, imported), { type: "piece-archived", v: 1, id: "e2", at: 20, pieceId: "p" });
    expect(archived.archivedAt).toBe(20);
    expect(() => applyPieceEvent(archived, { type: "phrases-changed", v: 1, id: "e3", at: 30, pieceId: "p", phraseStarts: [] })).toThrow();
    expect(() => applyPieceEvent(undefined, { type: "piece-archived", v: 1, id: "e4", at: 30, pieceId: "p" })).toThrow();
    expect(() => applyPieceEvent(archived, imported)).toThrow();
  });
});

describe("MemoryPieceLibrary", () => {
  it("imports a score once, keeps its changes and drops it when archived", async () => {
    const library = new MemoryPieceLibrary();
    const { record, existed } = await library.import(score("<score/>"));
    expect(existed).toBe(false);
    expect(record.settings.tempo).toBe(96);
    expect(await library.score(record)).toBe("<score/>");
    expect((await library.import(score("<score/>"))).existed).toBe(true);

    const split = await library.change(record, { type: "phrases-changed", phraseStarts: [4, 8] });
    expect((await library.list())[0].phraseStarts).toEqual([4, 8]);
    await library.change(split, { type: "piece-archived" });
    expect(await library.list()).toEqual([]);
    // The same score again is a new piece, with none of the old one's history.
    const again = await library.import(score("<score/>"));
    expect(again.existed).toBe(false);
    expect(again.record.id).not.toBe(record.id);
  });
});

type EventRow = { user_id: string; piece_id: string; id: string; type: string; event: PieceEvent };

/** Just enough of Supabase for AccountPieceLibrary: piece_events folded into pieces as the trigger does, and storage. */
function fakeClient(failInserts = 0) {
  const events: EventRow[] = [];
  const pieces = new Map<string, ReturnType<typeof applyPieceEvent>>();
  const objects = new Map<string, Blob>();
  const toRow = (r: ReturnType<typeof applyPieceEvent>) => ({
    id: r.id, title: r.title, composer: r.composer, file_name: r.fileName, score_hash: r.scoreHash, score_path: r.scorePath,
    measure_count: r.measureCount, phrase_starts: r.phraseStarts, settings: r.settings,
    created_at: new Date(r.createdAt).toISOString(), updated_at: new Date(r.updatedAt).toISOString(), archived_at: r.archivedAt ?? null,
  });
  let failures = failInserts;
  const client = {
    from: (table: string) => {
      if (table === "piece_events") {
        return {
          upsert(row: EventRow, options: { ignoreDuplicates: boolean }) {
            expect(options.ignoreDuplicates).toBe(true);
            if (failures-- > 0) return Promise.resolve({ error: { message: "network", code: "" } });
            if (!events.some((e) => e.user_id === row.user_id && e.id === row.id)) {
              events.push(row);
              pieces.set(row.piece_id, applyPieceEvent(pieces.get(row.piece_id), row.event));
            }
            return Promise.resolve({ error: null });
          },
        };
      }
      const filters: ((row: ReturnType<typeof toRow>) => boolean)[] = [];
      const rows = () => [...pieces.values()].map(toRow).filter((row) => filters.every((f) => f(row)));
      const query = {
        select: () => query,
        is: (column: "archived_at", value: null) => (filters.push((row) => row[column] === value), query),
        eq: (column: "score_hash", value: string) => (filters.push((row) => row[column] === value), query),
        order: () => Promise.resolve({ data: rows(), error: null }),
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      };
      return query;
    },
    storage: {
      from: () => ({
        upload(path: string, blob: Blob) {
          if (objects.has(path)) return Promise.resolve({ error: { message: "The resource already exists", statusCode: "409" } });
          objects.set(path, blob);
          return Promise.resolve({ error: null });
        },
        download: (path: string) => Promise.resolve(objects.has(path) ? { data: objects.get(path), error: null } : { data: null, error: { message: "not found" } }),
      }),
    },
  };
  return { client: client as unknown as SupabaseClient, events, objects };
}

describe("AccountPieceLibrary", () => {
  it("stores the score gzipped in the player's folder and the piece as events", async () => {
    const { client, events, objects } = fakeClient();
    const library = new AccountPieceLibrary(client, "user-1");
    const { record } = await library.import(score("<score-partwise/>"));

    expect([...objects.keys()]).toEqual([`user-1/${record.scoreHash}.musicxml.gz`]);
    expect(await gunzip(objects.get(record.scorePath)!)).toBe("<score-partwise/>");
    await library.change(record, { type: "settings-changed", settings: { ...record.settings, tempo: 60 } });
    expect(events.map((e) => e.type)).toEqual(["piece-imported", "settings-changed"]);
    expect((await library.list())[0].settings.tempo).toBe(60);
    // A fresh page reads the score back from storage.
    expect(await new AccountPieceLibrary(client, "user-1").score(record)).toBe("<score-partwise/>");
    expect((await library.import(score("<score-partwise/>"))).existed).toBe(true);
  });

  it("writes changes in the order they were made", async () => {
    const { client, events } = fakeClient();
    const library = new AccountPieceLibrary(client, "user-1");
    const { record } = await library.import(score("<a/>"));
    await Promise.all([1, 2, 3].map((n) => library.change(record, { type: "phrases-changed", phraseStarts: [n] })));
    expect(events.slice(1).map((e) => e.event.type === "phrases-changed" && e.event.phraseStarts[0])).toEqual([1, 2, 3]);
    expect((await library.list())[0].phraseStarts).toEqual([3]);
  });
});

describe("helpers", () => {
  it("round-trips gzip and makes v4 UUIDs", async () => {
    expect(await gunzip(await gzip("♩ = 96"))).toBe("♩ = 96");
    expect(newUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
