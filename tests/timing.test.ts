import { describe, expect, it } from "vitest";
import type { Note } from "../src/music/types";
import {
  acceptWindowMs,
  beatMs,
  expectedOnsets,
  onTimeWindowMs,
  phraseDurationMs,
  timingGrade,
} from "../src/practice/timing";

const note = (duration: Note["duration"]): Note => ({
  letter: "C",
  alter: 0,
  octave: 4,
  duration,
});

describe("timing", () => {
  it("computes beat length from tempo", () => {
    expect(beatMs(60)).toBe(1000);
    expect(beatMs(120)).toBe(500);
  });

  it("caps the on-time window at 200ms and keeps accept wider with a floor", () => {
    expect(onTimeWindowMs(60)).toBe(200);
    expect(onTimeWindowMs(120)).toBe(125);
    expect(acceptWindowMs(60)).toBe(500);
    expect(acceptWindowMs(120)).toBe(350);
  });

  it("schedules onsets from mixed durations at 60 BPM", () => {
    const notes = [note("q"), note("8"), note("8"), note("h"), note("w")];
    expect(expectedOnsets(notes, 60)).toEqual([0, 1000, 1500, 2000, 4000]);
    expect(phraseDurationMs(notes, 60)).toBe(8000);
  });

  it("grades early / on-time / late against the window", () => {
    // At 60 BPM window is 200ms.
    expect(timingGrade(0, 60)).toBe("on-time");
    expect(timingGrade(-200, 60)).toBe("on-time");
    expect(timingGrade(200, 60)).toBe("on-time");
    expect(timingGrade(-201, 60)).toBe("early");
    expect(timingGrade(201, 60)).toBe("late");
  });
});
