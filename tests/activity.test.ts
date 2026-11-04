import { describe, expect, it } from "vitest";
import { CARD_MAX_MS, dailyMinutes } from "../src/curriculum/activity";
import { playedMs, type CardAnswered, type PhraseCompleted } from "../src/curriculum/events";

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

  it("counts flashcards apart from phrases, each for as long as it was up but no longer than a minute", () => {
    const card = (answered: number, shown: number): CardAnswered => ({
      type: "card-answered",
      v: 1,
      id: `c${answered}`,
      at: answered,
      startedAt: shown,
      session: "s",
      concept: "treble/C/five",
      clef: "treble",
      key: "C",
      time: "4/4",
      notes: ["C4"],
      answer: [60],
      input: "screen",
    });
    const events = [card(at(0, 9), at(0, 9) - 15_000), card(at(0, 10), at(0, 10) - 10 * 60_000), phrase(at(0, 11), at(0, 11) - 60_000)];
    const [today] = dailyMinutes(events, 1, now);
    expect(today.cardMinutes).toBeCloseTo((15_000 + CARD_MAX_MS) / 60_000);
    expect(today.minutes).toBe(1);
  });
});
