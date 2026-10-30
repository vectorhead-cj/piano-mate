import { describe, expect, it } from "vitest";
import { accidentalsForBar } from "../src/music/accidentals";
import { generateExercise, minNotesForBars } from "../src/music/generator";
import { keyAlter, keyById, KEYS } from "../src/music/keys";
import { LEVEL_1, LEVELS, lesserLevel, levelsForClef } from "../src/music/levels";
import { midiOf, staffStep } from "../src/music/pitch";
import { BEATS, BEATS_PER_BAR, RHYTHM_PROFILES } from "../src/music/rhythms";
import type { Note, RhythmFlavor } from "../src/music/types";
import { seeded } from "./helpers";

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const opts = (
  overrides: Partial<{
    bars: number;
    key: string;
    accidentalFrequency: "none" | "rare" | "medium" | "common";
    rhythm: RhythmFlavor;
  }> = {},
) => ({
  bars: 4,
  key: "C",
  accidentalFrequency: "none" as const,
  rhythm: "basic" as const,
  ...overrides,
});

describe("rhythm cells", () => {
  it("defines cells that fill exactly one bar", () => {
    for (const profile of RHYTHM_PROFILES) {
      expect(profile.cells.length).toBeGreaterThan(0);
      for (const cell of profile.cells) {
        const beats = cell.pattern.reduce((sum, d) => sum + BEATS[d], 0);
        expect(beats).toBe(BEATS_PER_BAR);
        for (const duration of cell.pattern) {
          expect(profile.durations).toContain(duration);
        }
      }
    }
  });
});

describe("generateExercise", () => {
  it("fills every bar exactly for each rhythm flavor", () => {
    for (const profile of RHYTHM_PROFILES) {
      for (const seed of SEEDS) {
        const exercise = generateExercise(
          LEVEL_1,
          opts({ rhythm: profile.id, accidentalFrequency: "medium" }),
          seeded(seed),
        );
        expect(exercise.bars).toHaveLength(4);
        for (const bar of exercise.bars) {
          expect(bar.reduce((sum, n) => sum + BEATS[n.duration], 0)).toBe(4);
          for (const note of bar) {
            expect(profile.durations).toContain(note.duration);
          }
        }
      }
    }
  });

  it("uses at least n*2+1 notes in an n-bar phrase", () => {
    for (const bars of [1, 2, 3, 4] as const) {
      for (const profile of RHYTHM_PROFILES) {
        for (const seed of SEEDS) {
          const notes = generateExercise(
            LEVEL_1,
            opts({ bars, rhythm: profile.id }),
            seeded(seed),
          ).bars.flat();
          expect(notes.length).toBeGreaterThanOrEqual(minNotesForBars(bars));
        }
      }
    }
  });

  it("does not fit a wider level entirely inside the next-narrower level", () => {
    for (const level of LEVELS) {
      const lesser = lesserLevel(level);
      if (!lesser) continue;
      const lessLow = staffStep(lesser.lowest);
      const lessHigh = staffStep(lesser.highest);
      for (const seed of SEEDS) {
        const steps = generateExercise(level, opts({ bars: 4 }), seeded(seed)).bars.flat().map(staffStep);
        expect(steps.some((s) => s < lessLow || s > lessHigh)).toBe(true);
      }
    }
  });

  it("ends the last bar on a half or whole note when the flavor allows it", () => {
    for (const profile of RHYTHM_PROFILES) {
      const canEndLong = profile.durations.some((d) => d === "h" || d === "w");
      if (!canEndLong) continue;
      for (const seed of SEEDS) {
        const last = generateExercise(
          LEVEL_1,
          opts({ rhythm: profile.id }),
          seeded(seed),
        ).bars.at(-1)!;
        expect(["h", "w"]).toContain(last.at(-1)!.duration);
      }
    }
  });

  it("uses eighth notes in eighths and busy flavors", () => {
    for (const rhythm of ["eighths", "busy"] as const) {
      const notes = SEEDS.flatMap(
        (seed) => generateExercise(LEVEL_1, opts({ rhythm }), seeded(seed)).bars.flat(),
      );
      expect(notes.some((n) => n.duration === "8")).toBe(true);
    }
  });

  it("keeps basic rhythm free of eighths", () => {
    for (const seed of SEEDS) {
      const notes = generateExercise(LEVEL_1, opts(), seeded(seed)).bars.flat();
      expect(notes.every((n) => n.duration !== "8")).toBe(true);
    }
  });

  it("nests ranges within a clef and never across clefs", () => {
    expect(levelsForClef("treble").length).toBeGreaterThan(0);
    expect(levelsForClef("bass").length).toBeGreaterThan(0);
    for (const level of LEVELS) {
      const lesser = lesserLevel(level);
      if (!lesser) continue;
      expect(lesser.clef).toBe(level.clef);
      expect(staffStep(lesser.lowest)).toBeGreaterThanOrEqual(staffStep(level.lowest));
      expect(staffStep(lesser.highest)).toBeLessThanOrEqual(staffStep(level.highest));
    }
  });

  it("writes the level's clef on the exercise", () => {
    for (const level of LEVELS) {
      expect(generateExercise(level, opts(), seeded(1)).clef).toBe(level.clef);
    }
  });

  it("stays within each level's staff range", () => {
    for (const level of LEVELS) {
      const low = staffStep(level.lowest);
      const high = staffStep(level.highest);
      for (const seed of SEEDS) {
        const notes = generateExercise(level, opts(), seeded(seed)).bars.flat();
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
        opts({ bars: 2, accidentalFrequency: "medium" }),
        seeded(seed),
      ).bars.flat();
      expect(["C", "E", "G"]).toContain(notes[0].letter);
      expect(notes[0].alter).toBe(0);
      expect(notes.at(-1)).toMatchObject({ letter: "C", alter: 0 });
    }
  });

  it("approaches the final tonic by step or third when the phrase has room", () => {
    for (const seed of SEEDS) {
      const notes = generateExercise(
        LEVEL_1,
        opts({ bars: 4 }),
        seeded(seed),
      ).bars.flat();
      if (notes.length < 3) continue;
      const approach = Math.abs(staffStep(notes.at(-2)!) - staffStep(notes.at(-1)!));
      expect(approach).toBeLessThanOrEqual(2);
    }
  });

  it("recovers from leaps with contrary stepwise motion when possible", () => {
    for (const seed of SEEDS) {
      const notes = generateExercise(
        LEVELS[1],
        opts({ bars: 4, rhythm: "basic" }),
        seeded(seed),
      ).bars.flat();
      // Skip cadence notes: penultimate is approach-driven, final is the tonic.
      for (let i = 2; i < notes.length - 2; i++) {
        const incoming = staffStep(notes[i - 1]) - staffStep(notes[i - 2]);
        if (Math.abs(incoming) < 3) continue;
        const outgoing = staffStep(notes[i]) - staffStep(notes[i - 1]);
        expect(Math.sign(outgoing)).toBe(-Math.sign(incoming));
        expect(Math.abs(outgoing)).toBeLessThanOrEqual(2);
      }
    }
  });

  it("does not leap onto eighth notes", () => {
    for (const seed of SEEDS) {
      const notes = generateExercise(
        LEVELS[1],
        opts({ bars: 4, rhythm: "busy" }),
        seeded(seed),
      ).bars.flat();
      for (let i = 1; i < notes.length; i++) {
        if (notes[i].duration !== "8") continue;
        const leap = Math.abs(staffStep(notes[i]) - staffStep(notes[i - 1]));
        expect(leap).toBeLessThanOrEqual(2);
      }
    }
  });

  it("tends to arch: early notes sit below a mid-phrase high point", () => {
    let arched = 0;
    for (const seed of SEEDS) {
      const notes = generateExercise(
        LEVELS[2],
        opts({ bars: 4, rhythm: "basic" }),
        seeded(seed),
      ).bars.flat();
      if (notes.length < 6) continue;
      const steps = notes.map(staffStep);
      const peakAt = Math.max(1, Math.round((steps.length - 1) * 0.4));
      const early = steps.slice(0, peakAt);
      const aroundPeak = steps.slice(peakAt, Math.min(peakAt + 3, steps.length - 1));
      if (Math.max(...aroundPeak) >= Math.max(...early)) arched++;
    }
    expect(arched).toBeGreaterThan(SEEDS.length * 0.55);
  });

  it("applies the key signature to diatonic notes", () => {
    const key = keyById("G");
    for (const seed of SEEDS) {
      const notes = generateExercise(LEVEL_1, opts({ key: "G" }), seeded(seed)).bars.flat();
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
        opts({ accidentalFrequency: "common" }),
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
        generateExercise(LEVEL_1, opts({ accidentalFrequency: "common" }), seeded(seed)).bars.flat(),
    );
    expect(notes.some((n) => n.alter !== keyAlter(key, n.letter))).toBe(true);
  });

  it("can produce key-cancelling naturals (resets) in sharp keys", () => {
    const notes = SEEDS.flatMap(
      (seed) =>
        generateExercise(
          LEVEL_1,
          opts({ key: "G", accidentalFrequency: "common" }),
          seeded(seed),
        ).bars.flat(),
    );
    expect(notes.some((n) => n.letter === "F" && n.alter === 0)).toBe(true);
  });

  it("stores the selected key on the exercise for every western key", () => {
    for (const key of KEYS) {
      const exercise = generateExercise(
        LEVEL_1,
        opts({ bars: 1, key: key.id }),
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
