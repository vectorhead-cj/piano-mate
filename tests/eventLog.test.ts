// @vitest-environment happy-dom
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";
import { AccountEventLog, LocalEventLog, MemoryEventLog, type EventQuery } from "../src/curriculum/eventLog";
import { PROGRESS_EVENT_TYPES, type PracticeEvent } from "../src/curriculum/events";

type Row = { user_id: string; id: string; type: string; at: string; event: PracticeEvent };

/** Just enough of the Supabase query builder for AccountEventLog, over an in-memory table. */
function fakeClient(rows: Row[]) {
  const client = {
    from: () => ({
      upsert(batch: Row[], options: { ignoreDuplicates: boolean }) {
        expect(options.ignoreDuplicates).toBe(true);
        for (const row of batch) {
          if (!rows.some((r) => r.user_id === row.user_id && r.id === row.id)) rows.push(row);
        }
        return Promise.resolve({ error: null });
      },
      select: () => {
        const filters: ((row: Row) => boolean)[] = [];
        const query = {
          in: (column: string, values: string[]) => {
            expect(column).toBe("type");
            filters.push((row) => values.includes(row.type));
            return query;
          },
          order: () => query,
          range: (from: number, to: number) => {
            const sorted = rows.filter((row) => filters.every((f) => f(row))).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
            return Promise.resolve({ data: sorted.slice(from, to + 1).map(({ event }) => ({ event })), error: null });
          },
        };
        return query;
      },
    }),
  };
  return client as unknown as SupabaseClient;
}

function event(id: string, at: number): PracticeEvent {
  return { type: "track-started", v: 1, id, at, session: "s", clef: "treble", stageId: "t1" };
}

function intro(id: string, at: number, stageId: string): PracticeEvent {
  return { type: "intro-completed", v: 1, id, at, session: "s", clef: "treble", stageId, skipped: false };
}

function answer(id: string, at: number): PracticeEvent {
  return {
    type: "card-answered",
    v: 1,
    id,
    at,
    startedAt: at,
    session: "s",
    concept: "treble/C/five",
    clef: "treble",
    key: "C",
    time: "4/4",
    notes: ["C4", "D4", "E4", "F4"],
    answer: [60, 62, 64, 65],
    input: "screen",
  };
}

const ALL: EventQuery = { types: ["track-started", "intro-completed"] };

describe("AccountEventLog", () => {
  beforeEach(() => localStorage.clear());

  it("moves practice from before signing in into the account, once", async () => {
    localStorage.setItem("piano-mate.events.v1", JSON.stringify([event("a", 1), event("b", 2)]));
    const rows: Row[] = [];
    const log = new AccountEventLog(fakeClient(rows), "user-1");

    expect((await log.load(ALL)).map((e) => e.id)).toEqual(["a", "b"]);
    expect(rows.every((r) => r.user_id === "user-1")).toBe(true);
    expect(localStorage.getItem("piano-mate.events.v1")).toBeNull();
    expect(await log.load(ALL)).toHaveLength(2);
  });

  it("loads events across pages in time order", async () => {
    const rows: Row[] = [];
    const log = new AccountEventLog(fakeClient(rows), "user-1");
    for (let i = 1500; i > 0; i--) await log.append(event(`e${i}`, i));

    const loaded = await log.load(ALL);
    expect(loaded).toHaveLength(1500);
    expect(loaded[0].at).toBe(1);
    expect(loaded[1499].at).toBe(1500);
  });

  it("never stores a retried event twice", async () => {
    const rows: Row[] = [];
    const log = new AccountEventLog(fakeClient(rows), "user-1");
    await log.append(event("a", 1));
    await log.append(event("a", 1));
    expect(rows).toHaveLength(1);
  });

  it("moves flashcard answers from before signing in into the account with the rest", async () => {
    localStorage.setItem("piano-mate.events.v1", JSON.stringify([event("a", 1), answer("b", 2)]));
    const rows: Row[] = [];
    const log = new AccountEventLog(fakeClient(rows), "user-1");

    expect((await log.load({ types: PROGRESS_EVENT_TYPES })).map((e) => e.id)).toEqual(["a", "b"]);
    expect(localStorage.getItem("piano-mate.events.v1")).toBeNull();
    expect((await log.load({ types: ["card-answered"] })).map((e) => e.id)).toEqual(["b"]);
  });

  it("loads only the asked-for types", async () => {
    const rows: Row[] = [];
    const log = new AccountEventLog(fakeClient(rows), "user-1");
    await log.append(event("a", 1));
    await log.append(intro("b", 2, "t1"));

    expect((await log.load({ types: ["track-started"] })).map((e) => e.id)).toEqual(["a"]);
  });
});

describe.each([
  ["LocalEventLog", () => new LocalEventLog()],
  ["MemoryEventLog", () => new MemoryEventLog()],
])("%s", (_, make) => {
  beforeEach(() => localStorage.clear());

  it("loads only the asked-for types", async () => {
    const log = make();
    await log.append(event("a", 1));
    await log.append(intro("b", 2, "t1"));

    expect((await log.load(ALL)).map((e) => e.id)).toEqual(["a", "b"]);
    expect((await log.load({ types: ["track-started"] })).map((e) => e.id)).toEqual(["a"]);
  });
});
