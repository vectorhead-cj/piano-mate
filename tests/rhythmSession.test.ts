import { describe, expect, it } from "vitest";
import { exactPitch } from "../src/practice/matcher";
import { RhythmSession } from "../src/practice/rhythmSession";
import type { Exercise } from "../src/music/types";

const exercise: Exercise = {
  clef: "treble",
  key: "C",
  time: "4/4",
  pickup: 0,
  bars: [
    [
      { letter: "C", alter: 0, octave: 4, duration: "q" },
      { letter: "D", alter: 0, octave: 4, duration: "q" },
      { letter: "E", alter: 0, octave: 4, duration: "h" },
    ],
  ],
};

/** C, then E tied over the barline (one press held through both), then G. */
const tiedExercise: Exercise = {
  clef: "treble",
  key: "C",
  time: "4/4",
  pickup: 0,
  bars: [
    [
      { letter: "C", alter: 0, octave: 4, duration: "h" },
      { letter: "E", alter: 0, octave: 4, duration: "h", tie: true },
    ],
    [
      { letter: "E", alter: 0, octave: 4, duration: "h" },
      { letter: "G", alter: 0, octave: 4, duration: "h" },
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

  it("counts in a bar plus the beats before a pickup, and runs to the barline after the last note", () => {
    const pickup: Exercise = {
      clef: "treble",
      key: "C",
      time: "3/4",
      pickup: 1,
      bars: [
        [{ letter: "G", alter: 0, octave: 4, duration: "q" }],
        [
          { letter: "C", alter: 0, octave: 5, duration: "q." },
          { letter: "B", alter: 0, octave: 4, duration: "8" },
          { letter: "A", alter: 0, octave: 4, duration: "q" },
        ],
        // Ends on beat 2: the phrase stops mid-bar.
        [{ letter: "G", alter: 0, octave: 4, duration: "h" }],
      ],
    };
    const session = new RhythmSession(pickup, TEMPO, exactPitch);
    session.arm(0);
    expect(session.beatsPerBar).toBe(3);
    // One 3/4 bar, then beats 1 and 2 of the pickup's bar.
    expect(session.countInMs).toBe(5000);
    expect(session.play(67, 5000).result).toMatchObject({ kind: "correct", timing: "on-time" });
    expect(session.play(72, 6000).result).toMatchObject({ kind: "correct", timing: "on-time" });
    expect(session.play(71, 7500).result).toMatchObject({ kind: "correct", timing: "on-time" });
    // 5 count-in beats + 6 phrase beats = 11, rounded up to 12 (four 3/4 bars).
    expect(session.totalBeats).toBe(12);
    expect(session.endAt).toBe(12000);
  });

  it("counts in one bar of a 4/4 phrase without a pickup", () => {
    const session = sessionAt(0);
    expect(session.countInMs).toBe(COUNT_IN);
    expect(session.totalBeats).toBe(8);
  });

  it("expects no press for a tied note and times the next one after both", () => {
    const session = new RhythmSession(tiedExercise, TEMPO, exactPitch);
    session.arm(0);
    session.play(60, COUNT_IN);
    session.play(64, COUNT_IN + 2000);
    // The tied E lasts two more beats, so G is due at beat 6.
    expect(session.currentIndex).toBe(3);
    expect(session.play(67, COUNT_IN + 6000).result).toMatchObject({ kind: "correct", index: 3, timing: "on-time", completed: true });
    expect(session.score()).toEqual({ notesCorrect: 3, rhythmOnTime: 3, total: 3 });
  });

  it("misses a tied note together with the note it is held from", () => {
    const session = new RhythmSession(tiedExercise, TEMPO, exactPitch);
    session.arm(0);
    session.play(60, COUNT_IN);
    expect(session.tick(COUNT_IN + 2000 + 501).missed).toEqual([1, 2]);
    expect(session.currentIndex).toBe(3);
  });
});
