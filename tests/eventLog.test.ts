// @vitest-environment happy-dom
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";
import { AccountEventLog } from "../src/curriculum/eventLog";
import type { PracticeEvent } from "../src/curriculum/events";

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
        const query = {
          order: () => query,
          range: (from: number, to: number) => {
            const sorted = [...rows].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
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

describe("AccountEventLog", () => {
  beforeEach(() => localStorage.clear());

  it("moves practice from before signing in into the account, once", async () => {
    localStorage.setItem("piano-mate.events.v1", JSON.stringify([event("a", 1), event("b", 2)]));
    const rows: Row[] = [];
    const log = new AccountEventLog(fakeClient(rows), "user-1");

    expect((await log.load()).map((e) => e.id)).toEqual(["a", "b"]);
    expect(rows.every((r) => r.user_id === "user-1")).toBe(true);
    expect(localStorage.getItem("piano-mate.events.v1")).toBeNull();
    expect(await log.load()).toHaveLength(2);
  });

  it("loads events across pages in time order", async () => {
    const rows: Row[] = [];
    const log = new AccountEventLog(fakeClient(rows), "user-1");
    for (let i = 1500; i > 0; i--) await log.append(event(`e${i}`, i));

    const loaded = await log.load();
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
});
