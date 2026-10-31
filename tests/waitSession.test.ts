import { describe, expect, it } from "vitest";
import { exactPitch, samePitchClass } from "../src/practice/matcher";
import { WaitSession } from "../src/practice/waitSession";
import type { Exercise } from "../src/music/types";

const exercise: Exercise = {
  clef: "treble",
  key: "C",
  time: "4/4",
  pickup: 0,
  bars: [
    [
      { letter: "C", alter: 0, octave: 4, duration: "h" },
      { letter: "F", alter: 1, octave: 4, duration: "h" },
    ],
    [{ letter: "G", alter: 0, octave: 4, duration: "w" }],
  ],
};

describe("WaitSession", () => {
  it("advances only on the expected pitch", () => {
    const session = new WaitSession(exercise, exactPitch);

    expect(session.play(62)).toEqual({ kind: "wrong", index: 0, expectedPitch: 60 });
    expect(session.currentIndex).toBe(0);

    expect(session.play(60)).toEqual({ kind: "correct", index: 0, completed: false });
    expect(session.play(66)).toEqual({ kind: "correct", index: 1, completed: false });
    expect(session.play(67)).toEqual({ kind: "correct", index: 2, completed: true });

    expect(session.isComplete).toBe(true);
    expect(session.play(67)).toEqual({ kind: "ignored" });
  });

  it("accepts any octave with the pitch-class matcher", () => {
    const session = new WaitSession(exercise, samePitchClass);
    expect(session.play(84).kind).toBe("correct");
    expect(session.play(54).kind).toBe("correct");
  });

  it("scores notes correct only on the first try", () => {
    const session = new WaitSession(exercise, exactPitch);
    session.play(61);
    session.play(60);
    session.play(66);
    session.play(67);
    expect(session.score()).toEqual({ notesCorrect: 2, total: 3 });
  });
});
