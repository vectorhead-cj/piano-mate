import { describe, expect, it } from "vitest";
import { focusPlan } from "../src/piece/focusLoop";
import type { Piece, PieceMeasure } from "../src/piece/piece";

const BAR: PieceMeasure = { label: "1", start: 0, length: 4, beats: 4, time: "4/4", fifths: 0, mode: "major", repeatStart: false, repeatEnd: false, jump: false, clefs: { right: "G2", left: "F4" } };
const piece: Piece = { title: "", composer: "", measures: [0, 1, 2, 3].map((i) => ({ ...BAR, label: String(i + 1), start: i * 4 })), notes: [], warnings: [] };
const kinds = (plan: ReturnType<typeof focusPlan>) => plan.clicks.map((c) => c.kind[0]).join("");

describe("focusPlan", () => {
  it("starting in a bar's first half gets a clean bar first; ending by its middle, the rest of the bar counts back in", () => {
    // Bar 2 beat 2 to bar 3 beat 2 (to = where the next note starts, beat 3).
    const plan = focusPlan(piece, [0, 1, 2, 3], 5, 10);
    expect(plan.origin).toBe(4);
    expect(plan.intro.map((c) => c.at)).toEqual([-4, -3, -2, -1]);
    expect(plan.length).toBe(8);
    expect(plan.extra).toBe(0);
    expect(kinds(plan)).toBe("cpppppnn");
    expect(plan.clicks.filter((c) => c.accent).map((c) => c.at)).toEqual([0, 4]);
  });

  it("starting from the middle comes in during the count-in; ending after it adds a bar", () => {
    const plan = focusPlan(piece, [0, 1, 2, 3], 6, 11.5);
    expect(plan.intro).toEqual([]);
    expect(plan.extra).toBe(4);
    expect(plan.length).toBe(12);
    expect(kinds(plan)).toBe("ccppppppnnnn");
  });

  it("counts a selection ending on a barline as ending its bar, after the middle", () => {
    const plan = focusPlan(piece, [0, 1, 2, 3], 4, 8);
    expect(plan.length).toBe(8);
    expect(plan.intro).toHaveLength(4);
    expect(kinds(plan)).toBe("ppppnnnn");
  });

  it("ends exactly on the middle without an added bar", () => {
    const plan = focusPlan(piece, [0, 1, 2, 3], 2, 2 + 0);
    expect(plan.extra).toBe(0);
    expect(plan.intro).toEqual([]);
    expect(focusPlan(piece, [0, 1, 2, 3], 0, 2).extra).toBe(0);
    expect(focusPlan(piece, [0, 1, 2, 3], 0, 2.5).extra).toBe(4);
  });
});
