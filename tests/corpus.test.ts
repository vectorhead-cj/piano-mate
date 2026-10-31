import { describe, expect, it } from "vitest";
import { placedStage, type Stage } from "../src/curriculum/curriculum";
import { customSource, matchesAccidentals, MIN_STAGE_POOL, stagePool, stageSource } from "../src/curriculum/corpusSource";
import { spanLevel } from "../src/curriculum/spans";
import { parseBank, phraseInKey, type CorpusPhrase } from "../src/music/corpus";
import { staffStep } from "../src/music/pitch";
import { BEATS } from "../src/music/rhythms";
import { DEFAULT_SETTINGS, type Settings } from "../src/practice/settings";
import { seeded } from "./helpers";

type Row = Parameters<typeof parseBank>[0]["phrases"][number];

function bank(rows: Row[]) {
  return parseBank({
    v: 1,
    windows: ["five", "sixth", "authentic", "plagal", "dominant-octave", "tonic-twelfth", "dominant-twelfth", "two-octaves"],
    times: ["4/4", "3/4", "2/2"],
    rhythms: ["basic", "eighths", "busy"],
    sources: ["Bach (chorales and more): bwv1", "Essen folk songs: Ich fahr dahin"],
    phrases: rows,
  });
}

/** A 4-bar, basic, five-note C–G phrase in major, in 4/4 with no accidentals, like the stages ask for. */
const FIVE: Row = ["a", 0, "Soprano", 0, 0, 0, 0, 0, 0, 4, "0q 1q 2q 3q|4h 0h|2q 1q 2q 3q|4h 0h", 0];

/** The same shape in minor. */
const FIVE_MINOR: Row = [...FIVE.slice(0, 11), 1] as Row;

function copies(row: Row, count: number, change: (row: Row, i: number) => Row = (r) => r): CorpusPhrase[] {
  return bank(Array.from({ length: count }, (_, i) => change([...row] as Row, i)));
}

const fiveStage: Stage = placedStage("five-c")!.stage;

describe("parseBank", () => {
  it("reads notes, pickups, ranges and the source with its part", () => {
    const [phrase] = bank([["p", 1, "part 1", 1, 1, 1, 1, 1, 3, 2, "-3q|0q. 1#8 2q|4h", 1]]);
    expect(phrase).toMatchObject({
      mode: "minor",
      clef: "bass",
      time: "3/4",
      pickup: 1,
      rhythm: "eighths",
      chromatic: 1,
      window: "plagal",
      bars: 2,
      low: -3,
      high: 4,
      source: "Essen folk songs: Ich fahr dahin",
    });
    expect(phrase.notes[1][1]).toEqual({ step: 1, offset: 1, duration: "8", tie: false });
    const [tied] = bank([["t", 0, "S", 0, 0, 0, 1, 0, 0, 2, "0h 2h~|2h 0h", 0]]);
    expect(phraseInKey(tied, "C", staffStep({ letter: "C", alter: 0, octave: 4 }))!.bars[0][1].tie).toBe(true);
    expect(bank([FIVE])[0].source).toBe("Bach (chorales and more): bwv1 (Soprano)");
  });

  it("tags the notation each phrase uses", () => {
    const [plain, eighths, cut] = bank([
      FIVE,
      ["p", 1, "part 1", 1, 1, 1, 1, 1, 3, 2, "-3q|0q. 1#8 2q|4h. 4w~", 1],
      ["c", 0, "S", 0, 2, 0, 2, 0, 0, 1, "0h 1h", 0],
    ]);
    expect([...plain.notations].sort()).toEqual(["half", "quarter"]);
    expect([...eighths.notations].sort()).toEqual(
      ["dotted-half", "dotted-quarter", "eighth", "pickup", "quarter", "three-four", "tie", "whole"],
    );
    expect([...cut.notations].sort()).toEqual(["cut-time", "half"]);
  });
});

describe("phraseInKey", () => {
  it("spells steps and sharps relative to the new key", () => {
    const [phrase] = bank([["p", 0, "S", 0, 0, 0, 1, 1, 0, 2, "0q 3#q 4h|0w", 0]]);
    const inG = phraseInKey(phrase, "G", staffStep({ letter: "G", alter: 0, octave: 4 }))!;
    expect(inG.bars[0].map((n) => `${n.letter}${n.alter}${n.octave}`)).toEqual(["G04", "C15", "D05"]);
    expect(inG).toMatchObject({ key: "G", time: "4/4", pickup: 0, source: { id: "p" } });
    // C♯ major already sharpens F; a sharp on top would be a double sharp.
    const [sharpFour] = bank([["p", 0, "S", 0, 0, 0, 1, 1, 0, 2, "3#q 4q 4h|0w", 0]]);
    expect(phraseInKey(sharpFour, "C#", staffStep({ letter: "C", alter: 0, octave: 4 }))).toBeNull();
  });

  it("writes a minor phrase's raised 7th in the new minor key", () => {
    // Steps from the minor tonic: 1 7# 1 (A G♯ A in A minor).
    const [phrase] = bank([["p", 0, "S", 0, 0, 0, 0, 0, 0, 1, "0q -1#q 0h", 1]]);
    const inE = phraseInKey(phrase, "Em", staffStep({ letter: "E", alter: 0, octave: 4 }))!;
    expect(inE.bars[0].map((n) => `${n.letter}${n.alter}${n.octave}`)).toEqual(["E04", "D14", "E04"]);
  });
});

describe("matchesAccidentals", () => {
  it("maps none, rare, medium and common to 0, 1, 2 and 3+ chromatic notes", () => {
    expect([0, 1, 2, 3, 5].map((n) => matchesAccidentals(n, "common"))).toEqual([false, false, false, true, true]);
    expect(matchesAccidentals(0, "none")).toBe(true);
    expect(matchesAccidentals(1, "rare")).toBe(true);
    expect(matchesAccidentals(2, "medium")).toBe(true);
  });
});

describe("stagePool", () => {
  it("takes the stage's own range, accidentals and bars, plus a few from lower rhythm levels", () => {
    const corpus = [
      ...copies(FIVE, 60),
      ...copies(FIVE, 5, (r) => ((r[8] = 2), r)), // authentic octave: another stage's
      ...copies(FIVE, 5, (r) => ((r[7] = 1), r)), // one accidental
      ...copies(FIVE, 5, (r) => ((r[9] = 2), r)), // two bars
    ];
    expect(stagePool(corpus, "treble", fiveStage, "major")).toHaveLength(60);
    expect(stagePool(corpus, "treble", fiveStage, "minor")).toHaveLength(0);
    expect(stagePool(corpus, "bass", fiveStage, "major")).toHaveLength(0);

    const eighths: Stage = { ...fiveStage, rhythm: "eighths" };
    const mixed = [...copies(FIVE, 60, (r) => ((r[6] = 1), r)), ...copies(FIVE, 40)];
    // 60 of its own and a quarter as many basic ones.
    expect(stagePool(mixed, "treble", eighths, "major")).toHaveLength(75);
  });

  it("leaves out phrases using notation the stage hasn't introduced yet", () => {
    const corpus = [
      ...copies(FIVE, 60),
      ...copies(FIVE, 5, (r) => ((r[10] = "0q 1q 2h.|4h 0h|2q 1q 2q 3q|4h 0h"), r)), // dotted half
      ...copies(FIVE, 5, (r) => ((r[4] = 1), (r[10] = "0q 1q 2q|4h 0q|2q 1q 2q|4h."), r)), // 3/4
      ...copies(FIVE, 5, (r) => ((r[5] = 1), r)), // pickup
    ];
    const pool = (id: string) => stagePool(corpus, "treble", placedStage(id)!.stage, "major");
    expect(pool("five-c")).toHaveLength(60);
    expect(pool("five-g")).toHaveLength(65);
    expect(pool("five-cgf")).toHaveLength(70);
    expect(pool("five-d")).toHaveLength(75);
  });
});

describe("stageSource", () => {
  it("deals every real phrase once before repeating, placed on the stage's span", () => {
    const corpus = copies(FIVE, MIN_STAGE_POOL, (r, i) => ((r[0] = `p${i}`), r));
    const next = stageSource(corpus, "treble", fiveStage, seeded(1));
    const ids = Array.from({ length: MIN_STAGE_POOL }, () => next().source!.id);
    expect(new Set(ids).size).toBe(MIN_STAGE_POOL);
    const exercise = next();
    expect(exercise.bars[0][0]).toMatchObject(spanLevel("treble", "C", "five").lowest);
  });

  it("deals minor phrases in minor keys and major ones in major keys", () => {
    const corpus = [
      ...copies(FIVE, MIN_STAGE_POOL, (r, i) => ((r[0] = `major${i}`), r)),
      ...copies(FIVE_MINOR, MIN_STAGE_POOL, (r, i) => ((r[0] = `minor${i}`), r)),
    ];
    const next = stageSource(corpus, "treble", { ...fiveStage, keys: ["C", "Am"] }, seeded(1));
    for (let i = 0; i < 10; i++) {
      const exercise = next();
      expect(exercise.source!.id.startsWith(exercise.key === "Am" ? "minor" : "major")).toBe(true);
    }
  });

  it("generates phrases for a mode with too few real ones", () => {
    const corpus = copies(FIVE, MIN_STAGE_POOL, (r, i) => ((r[0] = `p${i}`), r));
    const next = stageSource(corpus, "treble", { ...fiveStage, keys: ["Am"] }, seeded(1));
    expect(next().source).toBeUndefined();
    expect(next().key).toBe("Am");
  });

  it("generates phrases when the stage has too few real ones", () => {
    const next = stageSource(copies(FIVE, MIN_STAGE_POOL - 1), "treble", fiveStage, seeded(1));
    expect(next().source).toBeUndefined();
    expect(stageSource(null, "treble", fiveStage, seeded(1))().source).toBeUndefined();
  });
});

describe("customSource", () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, range: "octave", key: "C", bars: 4, rhythm: "basic", time: "4/4" };

  it("places phrases inside the chosen range and key", () => {
    const next = customSource(copies(FIVE, 20), () => settings, seeded(2));
    const exercise = next()!;
    expect(exercise.source).toBeDefined();
    const steps = exercise.bars.flat().map(staffStep);
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(staffStep({ letter: "C", alter: 0, octave: 4 }));
    expect(Math.max(...steps)).toBeLessThanOrEqual(staffStep({ letter: "C", alter: 0, octave: 5 }));
    for (const bar of exercise.bars) expect(bar.reduce((sum, n) => sum + BEATS[n.duration], 0)).toBe(4);
  });

  it("places minor phrases in the relative minor", () => {
    // A–E doesn't fit C4–C5, so use the treble staff.
    const next = customSource(copies(FIVE_MINOR, 20), () => ({ ...settings, range: "treble-staff" }), seeded(2));
    expect(next()!.key).toBe("Am");
  });

  it("returns null for generated phrases, or when too few real ones match", () => {
    expect(customSource(copies(FIVE, 20), () => ({ ...settings, source: "generator" }))()).toBeNull();
    expect(customSource(copies(FIVE, 20), () => ({ ...settings, time: "3/4" }))()).toBeNull();
    expect(customSource(copies(FIVE, 20), () => settings)()).not.toBeNull();
  });
});
