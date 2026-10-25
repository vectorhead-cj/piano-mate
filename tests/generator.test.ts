import { describe, expect, it } from "vitest";
import { accidentalsForBar } from "../src/music/accidentals";
import { generateExercise } from "../src/music/generator";
import { LEVEL_1 } from "../src/music/levels";
import { midiOf, staffStep } from "../src/music/pitch";
import type { Note } from "../src/music/types";
import { seeded } from "./helpers";

const BEATS = { w: 4, h: 2, q: 1 };
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

describe("generateExercise", () => {
  it("fills every bar exactly", () => {
    for (const seed of SEEDS) {
      const exercise = generateExercise(LEVEL_1, { bars: 4, accidentals: true }, seeded(seed));
      expect(exercise.bars).toHaveLength(4);
      for (const bar of exercise.bars) {
        expect(bar.reduce((sum, n) => sum + BEATS[n.duration], 0)).toBe(4);
      }
    }
  });

  it("stays within the level's staff range", () => {
    const low = staffStep(LEVEL_1.lowest);
    const high = staffStep(LEVEL_1.highest);
    for (const seed of SEEDS) {
      const notes = generateExercise(LEVEL_1, { bars: 4, accidentals: false }, seeded(seed)).bars.flat();
      for (const note of notes) {
        expect(staffStep(note)).toBeGreaterThanOrEqual(low);
        expect(staffStep(note)).toBeLessThanOrEqual(high);
        expect(note.alter).toBe(0);
      }
    }
  });

  it("starts on the tonic triad and ends on C", () => {
    for (const seed of SEEDS) {
      const notes = generateExercise(LEVEL_1, { bars: 2, accidentals: true }, seeded(seed)).bars.flat();
      expect(["C", "E", "G"]).toContain(notes[0].letter);
      expect(notes[0].alter).toBe(0);
      expect(notes.at(-1)).toMatchObject({ letter: "C", alter: 0 });
    }
  });

  it("only uses accidentals that resolve by step", () => {
    for (const seed of SEEDS) {
      const notes = generateExercise(LEVEL_1, { bars: 4, accidentals: true }, seeded(seed)).bars.flat();
      notes.forEach((note, i) => {
        if (note.alter === 0) return;
        const motion = staffStep(notes[i + 1]) - staffStep(note);
        expect(motion).toBe(note.alter);
      });
    }
  });

  it("produces accidentals somewhere when enabled", () => {
    const notes = SEEDS.flatMap(
      (seed) => generateExercise(LEVEL_1, { bars: 4, accidentals: true }, seeded(seed)).bars.flat(),
    );
    expect(notes.some((n) => n.alter !== 0)).toBe(true);
  });
});

describe("accidentalsForBar", () => {
  const note = (letter: Note["letter"], alter: Note["alter"]): Note => ({
    letter,
    alter,
    octave: 4,
    duration: "q",
  });

  it("prints a sign once per bar and a natural when cancelled", () => {
    const bar = [note("F", 1), note("F", 1), note("F", 0), note("G", 0)];
    expect(accidentalsForBar(bar)).toEqual(["#", null, "n", null]);
  });

  it("treats different octaves as different staff positions", () => {
    const bar = [note("F", 1), { ...note("F", 0), octave: 5 }];
    expect(accidentalsForBar(bar)).toEqual(["#", null]);
  });

  it("matches MIDI pitch for flats", () => {
    expect(midiOf(note("B", -1))).toBe(70);
    expect(accidentalsForBar([note("B", -1), note("A", 0)])).toEqual(["b", null]);
  });
});
