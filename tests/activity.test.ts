import { describe, expect, it } from "vitest";
import { dailyMinutes } from "../src/curriculum/activity";
import { playedMs, type PhraseCompleted } from "../src/curriculum/events";

function phrase(at: number, startedAt?: number, time?: PhraseCompleted["config"]["time"]): PhraseCompleted {
  return {
    type: "phrase-completed",
    v: 1,
    id: `p${at}`,
    at,
    startedAt,
    session: "s",
    context: { kind: "custom" },
    mode: "wait",
    input: "screen",
    config: { clef: "treble", key: "C", lowest: "C4", highest: "G4", accidentals: "none", rhythm: "basic", bars: 4, time },
    barSizes: [1],
    notes: [{ pitch: "C4", duration: "w", wrong: 0, hit: true }],
  };
}

describe("playedMs", () => {
  it("runs from the first press to the end", () => {
    expect(playedMs(phrase(50_000, 20_000))).toBe(30_000);
  });

  it("takes four bars at 60 bpm for phrases recorded without a start", () => {
    expect(playedMs(phrase(50_000))).toBe(16_000);
    expect(playedMs(phrase(50_000, undefined, "3/4"))).toBe(12_000);
  });
});

describe("dailyMinutes", () => {
  const now = new Date(2026, 10, 3, 18, 0).getTime();
  const at = (daysAgo: number, hour: number) => new Date(2026, 10, 3 - daysAgo, hour).getTime();

  it("totals each local day, oldest first, ending today", () => {
    const events = [
      phrase(at(0, 9), at(0, 9) - 60_000),
      phrase(at(0, 23), at(0, 23) - 120_000),
      phrase(at(2, 0) + 1, at(2, 0) + 1 - 30_000),
      phrase(at(9, 12), at(9, 12) - 60_000),
    ];
    const days = dailyMinutes(events, 3, now);
    expect(days.map((d) => d.day)).toEqual([at(2, 0), at(1, 0), at(0, 0)]);
    expect(days.map((d) => d.minutes)).toEqual([0.5, 0, 3]);
  });
});
