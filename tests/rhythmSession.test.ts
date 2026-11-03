import { describe, expect, it } from "vitest";
import { HOLD_POLICIES } from "../src/practice/holds";
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
    expect(session.marks()).toEqual({ notes: ["correct", "pending", "pending"], rhythm: ["correct", "pending", "pending"] });
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
    expect(session.marks()).toEqual({ notes: ["correct", "correct", "pending"], rhythm: ["wrong", "wrong", "pending"] });
  });

  it("spoils a note pressed before its window, once the count-in is over", () => {
    const session = sessionAt(0);
    session.play(60, COUNT_IN);
    // D is due at 5000; the accept window opens at 4500.
    expect(session.play(62, COUNT_IN + 100).result).toEqual({ kind: "early", index: 1 });
    expect(session.currentIndex).toBe(1);
    expect(session.play(62, COUNT_IN + 1000).result).toMatchObject({ kind: "correct", index: 1, timing: "on-time" });
    expect(session.results()[1]).toMatchObject({ wrong: 1, early: 1, hit: true });
    expect(session.marks()).toEqual({ notes: ["correct", "correct", "pending"], rhythm: ["correct", "wrong", "pending"] });
  });

  it("counts a wrong key pressed before the window as a wrong note", () => {
    const session = sessionAt(0);
    session.play(60, COUNT_IN);
    expect(session.play(64, COUNT_IN + 100).result).toEqual({ kind: "wrong", index: 1, expectedPitch: 62 });
    expect(session.results()[1].early).toBeUndefined();
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
    expect(session.marks().notes[0]).toBe("wrong");
    const { result } = session.play(60, COUNT_IN + 50);
    expect(result).toMatchObject({ kind: "correct", index: 0, timing: "on-time" });
    expect(session.marks()).toEqual({ notes: ["wrong", "pending", "pending"], rhythm: ["correct", "pending", "pending"] });
  });

  it("misses a note when the accept window closes", () => {
    const session = sessionAt(0);
    // Accept window at 60 BPM is 500ms; first note deadline = COUNT_IN + 500.
    const tick = session.tick(COUNT_IN + 501);
    expect(tick.missed).toEqual([0]);
    expect(tick.currentIndex).toBe(1);
    expect(session.marks()).toEqual({ notes: ["wrong", "pending", "pending"], rhythm: ["wrong", "pending", "pending"] });
  });

  it("completes with a full score after the last note", () => {
    const session = sessionAt(0);
    session.play(60, COUNT_IN);
    session.play(62, COUNT_IN + 1000);
    const { result } = session.play(64, COUNT_IN + 2000);
    expect(result).toMatchObject({ kind: "correct", index: 2, completed: true });
    expect(session.marks()).toEqual({ notes: ["correct", "correct", "correct"], rhythm: ["correct", "correct", "correct"] });
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
    expect(session.marks()).toEqual({ notes: ["correct", "correct", "correct"], rhythm: ["correct", "correct", "correct"] });
  });

  it("misses a tied note together with the note it is held from", () => {
    const session = new RhythmSession(tiedExercise, TEMPO, exactPitch);
    session.arm(0);
    session.play(60, COUNT_IN);
    expect(session.tick(COUNT_IN + 2000 + 501).missed).toEqual([1, 2]);
    expect(session.currentIndex).toBe(3);
  });
});

describe("RhythmSession holds", () => {
  /** C and D quarters, then an E half, at 60 bpm: written ends at 5000, 6000 and 8000. */
  function holdSession(strictness: "coach" | "strict"): RhythmSession {
    const session = new RhythmSession(exercise, TEMPO, exactPitch, HOLD_POLICIES[strictness]);
    session.arm(0);
    return session;
  }

  it("coaches half notes let go before a quarter of their length, and leaves quarters be", () => {
    const session = holdSession("coach");
    session.play(60, COUNT_IN);
    expect(session.release(60, COUNT_IN + 100)).toEqual({ index: 0, short: false });
    session.play(62, COUNT_IN + 1000);
    session.release(62, COUNT_IN + 1000);
    session.play(64, COUNT_IN + 2000);
    expect(session.release(64, COUNT_IN + 2400)).toEqual({ index: 2, short: true });
    expect(session.results().map((n) => n.hold)).toEqual([undefined, undefined, "short"]);
    expect(session.results()[2].releaseMs).toBe(-1600);
    // Coaching never fails a note: its rhythm dot stays clean.
    expect(session.marks().rhythm).toEqual(["correct", "correct", "correct"]);
  });

  it("holds every note to half its length when strict", () => {
    const session = holdSession("strict");
    session.play(60, COUNT_IN);
    expect(session.release(60, COUNT_IN + 450)?.short).toBe(true);
    expect(session.marks().rhythm[0]).toBe("wrong");
    session.play(62, COUNT_IN + 1000);
    expect(session.release(62, COUNT_IN + 1500)?.short).toBe(false);
    session.play(64, COUNT_IN + 2000);
    expect(session.release(64, COUNT_IN + 2000 + 950)?.short).toBe(true);
  });

  it("grades a release against the beat, so a late press let go on time was held right", () => {
    const session = holdSession("strict");
    session.play(60, COUNT_IN);
    session.release(60, COUNT_IN + 1000);
    // Pressed 300ms late, held 250ms: let go at 55% of the written quarter.
    session.play(62, COUNT_IN + 1300);
    expect(session.release(62, COUNT_IN + 1550)).toEqual({ index: 1, short: false });
  });

  it("flags a key held well into the next note, by half its length when coaching and a quarter when strict", () => {
    const coach = holdSession("coach");
    coach.play(60, COUNT_IN);
    expect(coach.overheld(COUNT_IN + 1500)).toEqual([]);
    expect(coach.overheld(COUNT_IN + 1501)).toEqual([0]);
    expect(coach.results()[0].hold).toBe("long");
    // No longer followed: its release changes nothing.
    expect(coach.release(60, COUNT_IN + 2000)).toBeNull();

    const strict = holdSession("strict");
    strict.play(60, COUNT_IN);
    expect(strict.overheld(COUNT_IN + 1251)).toEqual([0]);
  });

  it("holds a tied note through the notes it's tied on to", () => {
    const session = new RhythmSession(tiedExercise, TEMPO, exactPitch, HOLD_POLICIES.coach);
    session.arm(0);
    session.play(60, COUNT_IN);
    session.release(60, COUNT_IN + 2000);
    session.play(64, COUNT_IN + 2000);
    // The tied E is four beats long: let go after 0.9 of them is too soon.
    expect(session.release(64, COUNT_IN + 2900)).toEqual({ index: 1, short: true });
    expect(session.holding()).toEqual([]);
  });

  it("lets go of a key still down when it's played again", () => {
    const repeated: Exercise = { ...exercise, bars: [[{ letter: "C", alter: 0, octave: 4, duration: "h" }, { letter: "C", alter: 0, octave: 4, duration: "h" }]] };
    const session = new RhythmSession(repeated, TEMPO, exactPitch);
    session.arm(0);
    session.play(60, COUNT_IN);
    session.play(60, COUNT_IN + 2000);
    expect(session.results()[0].releaseMs).toBe(0);
    expect(session.holding()).toEqual([{ index: 1, pressedAt: COUNT_IN + 2000, endsAt: COUNT_IN + 4000 }]);
  });
});
