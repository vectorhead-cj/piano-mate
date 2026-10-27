import { describe, expect, it } from "vitest";
import { exactPitch } from "../src/practice/matcher";
import { RhythmSession } from "../src/practice/rhythmSession";
import type { Exercise } from "../src/music/types";

const exercise: Exercise = {
  clef: "treble",
  key: "C",
  beatsPerBar: 4,
  bars: [
    [
      { letter: "C", alter: 0, octave: 4, duration: "q" },
      { letter: "D", alter: 0, octave: 4, duration: "q" },
      { letter: "E", alter: 0, octave: 4, duration: "h" },
    ],
  ],
};

const TEMPO = 60;
const COUNT_IN = 4000; // 4 beats at 60 BPM

function sessionAt(armAt: number): RhythmSession {
  const session = new RhythmSession(exercise, TEMPO, exactPitch);
  session.arm(armAt);
  return session;
}

describe("RhythmSession", () => {
  it("ignores input during count-in", () => {
    const session = sessionAt(0);
    expect(session.play(60, 1000).result.kind).toBe("ignored");
    expect(session.currentIndex).toBe(0);
  });

  it("scores an on-time correct pitch", () => {
    const session = sessionAt(0);
    const { result } = session.play(60, COUNT_IN);
    expect(result).toMatchObject({ kind: "correct", index: 0, timing: "on-time", completed: false });
    expect(session.score()).toEqual({ notesCorrect: 1, rhythmOnTime: 1, total: 3 });
  });

  it("marks early and late correct pitches", () => {
    const session = sessionAt(0);
    // On-time ±200ms; accept ±500ms at 60 BPM.
    expect(session.play(60, COUNT_IN - 250).result).toMatchObject({
      kind: "correct",
      timing: "early",
    });
    expect(session.play(62, COUNT_IN + 1000 + 250).result).toMatchObject({
      kind: "correct",
      timing: "late",
    });
    expect(session.score()).toEqual({ notesCorrect: 2, rhythmOnTime: 0, total: 3 });
  });

  it("rejects wrong pitch without advancing", () => {
    const session = sessionAt(0);
    const { result } = session.play(61, COUNT_IN);
    expect(result).toEqual({ kind: "wrong", index: 0, expectedPitch: 60 });
    expect(session.currentIndex).toBe(0);
  });

  it("allows correct pitch after a wrong one in the same window", () => {
    const session = sessionAt(0);
    session.play(61, COUNT_IN);
    const { result } = session.play(60, COUNT_IN + 50);
    expect(result).toMatchObject({ kind: "correct", index: 0, timing: "on-time" });
  });

  it("misses a note when the accept window closes", () => {
    const session = sessionAt(0);
    // Accept window at 60 BPM is 500ms; first note deadline = COUNT_IN + 500.
    const tick = session.tick(COUNT_IN + 501);
    expect(tick.missed).toEqual([0]);
    expect(tick.currentIndex).toBe(1);
    expect(session.score()).toEqual({ notesCorrect: 0, rhythmOnTime: 0, total: 3 });
  });

  it("completes with a full score after the last note", () => {
    const session = sessionAt(0);
    session.play(60, COUNT_IN);
    session.play(62, COUNT_IN + 1000);
    const { result } = session.play(64, COUNT_IN + 2000);
    expect(result).toMatchObject({ kind: "correct", index: 2, completed: true });
    expect(session.score()).toEqual({ notesCorrect: 3, rhythmOnTime: 3, total: 3 });
  });
});
