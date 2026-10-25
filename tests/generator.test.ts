import { describe, expect, it } from "vitest";
import { accidentalsForBar } from "../src/music/accidentals";
import { generateExercise } from "../src/music/generator";
import { keyAlter, keyById, KEYS } from "../src/music/keys";
import { LEVEL_1, LEVELS } from "../src/music/levels";
import { midiOf, staffStep } from "../src/music/pitch";
import type { Note } from "../src/music/types";
import { seeded } from "./helpers";

const BEATS = { w: 4, h: 2, q: 1 };
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

describe("generateExercise", () => {
  it("fills every bar exactly", () => {
    for (const seed of SEEDS) {
      const exercise = generateExercise(
        LEVEL_1,
        { bars: 4, key: "C", accidentalFrequency: "medium" },
        seeded(seed),
      );
      expect(exercise.bars).toHaveLength(4);
      for (const bar of exercise.bars) {
        expect(bar.reduce((sum, n) => sum + BEATS[n.duration], 0)).toBe(4);
      }
    }
  });

  it("stays within each level's staff range", () => {
    for (const level of LEVELS) {
      const low = staffStep(level.lowest);
      const high = staffStep(level.highest);
      for (const seed of SEEDS) {
        const notes = generateExercise(
          level,
          { bars: 4, key: "C", accidentalFrequency: "none" },
          seeded(seed),
        ).bars.flat();
        for (const note of notes) {
          expect(staffStep(note)).toBeGreaterThanOrEqual(low);
          expect(staffStep(note)).toBeLessThanOrEqual(high);
          expect(note.alter).toBe(0);
        }
      }
    }
  });

  it("starts on the tonic triad and ends on the tonic in C", () => {
    for (const seed of SEEDS) {
      const notes = generateExercise(
        LEVEL_1,
        { bars: 2, key: "C", accidentalFrequency: "medium" },
        seeded(seed),
      ).bars.flat();
      expect(["C", "E", "G"]).toContain(notes[0].letter);
      expect(notes[0].alter).toBe(0);
      expect(notes.at(-1)).toMatchObject({ letter: "C", alter: 0 });
    }
  });

  it("applies the key signature to diatonic notes", () => {
    const key = keyById("G");
    for (const seed of SEEDS) {
      const notes = generateExercise(
        LEVEL_1,
        { bars: 4, key: "G", accidentalFrequency: "none" },
        seeded(seed),
      ).bars.flat();
      for (const note of notes) {
        expect(note.alter).toBe(keyAlter(key, note.letter));
      }
      expect(notes.at(-1)?.letter).toBe("G");
    }
  });

  it("only uses chromatic accidentals that resolve by step", () => {
    for (const seed of SEEDS) {
      const key = keyById("C");
      const notes = generateExercise(
        LEVEL_1,
        { bars: 4, key: "C", accidentalFrequency: "common" },
        seeded(seed),
      ).bars.flat();
      notes.forEach((note, i) => {
        const diatonic = keyAlter(key, note.letter);
        if (note.alter === diatonic) return;
        const motion = staffStep(notes[i + 1]) - staffStep(note);
        expect(motion).toBe(note.alter - diatonic);
      });
    }
  });

  it("produces non-diatonic accidentals when frequency is not none", () => {
    const key = keyById("C");
    const notes = SEEDS.flatMap(
      (seed) =>
        generateExercise(
          LEVEL_1,
          { bars: 4, key: "C", accidentalFrequency: "common" },
          seeded(seed),
        ).bars.flat(),
    );
    expect(notes.some((n) => n.alter !== keyAlter(key, n.letter))).toBe(true);
  });

  it("can produce key-cancelling naturals (resets) in sharp keys", () => {
    const notes = SEEDS.flatMap(
      (seed) =>
        generateExercise(
          LEVEL_1,
          { bars: 4, key: "G", accidentalFrequency: "common" },
          seeded(seed),
        ).bars.flat(),
    );
    expect(notes.some((n) => n.letter === "F" && n.alter === 0)).toBe(true);
  });

  it("stores the selected key on the exercise for every western key", () => {
    for (const key of KEYS) {
      const exercise = generateExercise(
        LEVEL_1,
        { bars: 1, key: key.id, accidentalFrequency: "none" },
        seeded(1),
      );
      expect(exercise.key).toBe(key.id);
    }
  });
});

describe("accidentalsForBar", () => {
  const note = (letter: Note["letter"], alter: Note["alter"]): Note => ({
    letter,
    alter,
    octave: 4,
    duration: "q",
  });
  const cMajor = keyById("C");
  const gMajor = keyById("G");

  it("prints a sign once per bar and a natural when cancelled", () => {
    const bar = [note("F", 1), note("F", 1), note("F", 0), note("G", 0)];
    expect(accidentalsForBar(bar, cMajor)).toEqual(["#", null, "n", null]);
  });

  it("treats different octaves as different staff positions", () => {
    const bar = [note("F", 1), { ...note("F", 0), octave: 5 }];
    expect(accidentalsForBar(bar, cMajor)).toEqual(["#", null]);
  });

  it("omits accidentals already in the key signature", () => {
    const bar = [note("F", 1), note("G", 0), note("F", 0)];
    expect(accidentalsForBar(bar, gMajor)).toEqual([null, null, "n"]);
  });

  it("matches MIDI pitch for flats", () => {
    expect(midiOf(note("B", -1))).toBe(70);
    expect(accidentalsForBar([note("B", -1), note("A", 0)], cMajor)).toEqual(["b", null]);
  });
});
