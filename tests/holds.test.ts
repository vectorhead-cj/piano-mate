import { describe, expect, it } from "vitest";
import { firstFault, isPerfect, type PhraseCompleted } from "../src/curriculum/events";
import { faultyNotes } from "../src/practice/holds";
import type { NoteResult } from "../src/practice/waitSession";

const clean: NoteResult = { wrong: 0, hit: true };
const short: NoteResult = { ...clean, hold: "short" };
const long: NoteResult = { ...clean, hold: "long" };

describe("hold faults in a phrase", () => {
  it("never count while coaching", () => {
    expect(faultyNotes([short, long, short], "coach")).toEqual([false, false, false]);
  });

  it("forgive the first when strict, and count each after it", () => {
    expect(faultyNotes([short, clean, clean], "strict")).toEqual([false, false, false]);
    expect(faultyNotes([long, clean, short, short], "strict")).toEqual([false, false, true, true]);
  });

  it("make a phrase imperfect from the second, which is its first fault", () => {
    const event = { notes: [short, clean, long], barSizes: [3], holds: "strict" } as unknown as PhraseCompleted;
    expect(isPerfect(event)).toBe(false);
    expect(firstFault(event)).toEqual({ kind: "long", bar: 1, index: 2 });
    expect(isPerfect({ ...event, notes: [short, clean, clean] } as unknown as PhraseCompleted)).toBe(true);
  });

  it("leave phrases logged before holds were graded as they were", () => {
    expect(faultyNotes([short, long])).toEqual([false, false]);
  });
});
