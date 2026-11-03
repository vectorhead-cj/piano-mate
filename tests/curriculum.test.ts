import { describe, expect, it } from "vitest";
import {
  MASTERY_ROUNDS,
  MISS_WINDOW,
  PLACED_STAGES,
  placedStage,
  STAR_STREAK,
  stageExercises,
  stageNotations,
  stageReviews,
  stageTitle,
  type Tier,
} from "../src/curriculum/curriculum";
import { generateExercise } from "../src/music/generator";
import { keyById, MINOR_KEYS } from "../src/music/keys";
import { exerciseToMusicXml } from "../src/music/musicXml";
import { firstFault, type IntroCompleted, type InputKind, type PhraseCompleted } from "../src/curriculum/events";
import { milestoneBetween, projectProgress, recentHits, unlockAll } from "../src/curriculum/progress";
import { spanLevel } from "../src/curriculum/spans";
import { midiOf, staffStep } from "../src/music/pitch";
import type { Clef } from "../src/music/types";
import { seeded } from "./helpers";

let clock = 0;

function phrase(
  stageId: string,
  tier: Tier,
  perfect: boolean,
  input: InputKind = "midi",
  clef: Clef = "treble",
): PhraseCompleted {
  return {
    type: "phrase-completed",
    v: 1,
    id: `e${clock}`,
    at: ++clock,
    session: "s",
    context: { kind: "curriculum", clef, stageId, tier },
    mode: tier === "read" ? "wait" : "rhythm",
    input,
    config: { clef, key: "C", lowest: "C4", highest: "G4", accidentals: "none", rhythm: "basic", bars: 1 },
    barSizes: [2],
    notes: [
      { pitch: "C4", duration: "h", wrong: 0, hit: true },
      { pitch: "D4", duration: "h", wrong: perfect ? 0 : 1, hit: true },
    ],
  };
}

const repeat = (n: number, make: () => PhraseCompleted) => Array.from({ length: n }, make);

function introDone(stageId: string, clef: Clef = "treble"): IntroCompleted {
  return { type: "intro-completed", v: 1, id: `i${clock}`, at: ++clock, session: "s", clef, stageId, skipped: false };
}

const [first, second, third] = PLACED_STAGES.map((p) => p.stage.id);

describe("spanLevel", () => {
  it("starts the five-note span on the key's tonic", () => {
    const c = spanLevel("treble", "C", "five");
    expect([c.lowest, c.highest].map((s) => `${s.letter}${s.octave}`)).toEqual(["C4", "G4"]);
    const g = spanLevel("treble", "G", "five");
    expect([g.lowest, g.highest].map((s) => `${s.letter}${s.octave}`)).toEqual(["G4", "D5"]);
  });

  it("spells the bottom note in the key", () => {
    expect(spanLevel("treble", "Bb", "octave").lowest).toMatchObject({ letter: "B", alter: -1 });
  });

  it("shifts wide spans to stay near the staff", () => {
    const bass = spanLevel("bass", "C", "two-octaves");
    expect(midiOf(bass.lowest)).toBe(36); // C2
    const treble = spanLevel("treble", "G", "two-octaves");
    expect(staffStep(treble.lowest)).toBe(staffStep({ letter: "G", alter: 0, octave: 3 }));
  });

  it("gives the next-narrower span as the inner range", () => {
    const octave = spanLevel("treble", "D", "octave");
    expect(octave.inner && staffStep(octave.inner.highest) - staffStep(octave.inner.lowest)).toBe(4);
  });
});

describe("curriculum", () => {
  it("has unique stage ids", () => {
    const ids = PLACED_STAGES.map((p) => p.stage.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("introduces each notation once, starting from quarter, half and whole notes", () => {
    const introduced = PLACED_STAGES.flatMap((p) => p.stage.introduces);
    expect(new Set(introduced).size).toBe(introduced.length);
    expect(PLACED_STAGES[0].stage.introduces).toEqual(["quarter", "half", "whole"]);
    expect([...stageNotations(placedStage("five-g")!.stage)].sort()).toEqual(["dotted-half", "half", "quarter", "whole"]);
    expect(stageNotations(PLACED_STAGES[PLACED_STAGES.length - 1].stage).size).toBe(introduced.length);
  });

  it("generates stage phrases with only the note values introduced so far", () => {
    const next = stageExercises("treble", placedStage("five-c")!.stage, seeded(3));
    for (let i = 0; i < 20; i++) {
      for (const note of next().bars.flat()) expect(["w", "h", "q"]).toContain(note.duration);
    }
  });

  it("keeps every stage phrase inside its span and key set", () => {
    const random = seeded(7);
    for (const { stage } of PLACED_STAGES) {
      const next = stageExercises("treble", stage, random);
      for (let i = 0; i < 5; i++) {
        const exercise = next();
        expect(stage.keys).toContain(exercise.key);
        const level = spanLevel("treble", exercise.key, stage.span);
        for (const note of exercise.bars.flat()) {
          expect(staffStep(note)).toBeGreaterThanOrEqual(staffStep(level.lowest));
          expect(staffStep(note)).toBeLessThanOrEqual(staffStep(level.highest));
        }
      }
    }
  });
});

describe("stageReviews", () => {
  const ids = (stageId: string) => stageReviews(placedStage(stageId)!.stage).map((r) => r.stage.id);

  it("reviews earlier stages that fit the stage's span, most recent first and weighing most", () => {
    expect(ids("five-c")).toEqual([]);
    expect(ids("five-f")).toEqual(["five-g", "five-c"]);
    expect(stageReviews(placedStage("five-f")!.stage).map((r) => r.weight)).toEqual([1, 1 / 2]);
    // Minor keys on five notes review the five-note stages, not the wider ones in between.
    expect(ids("five-am").every((id) => placedStage(id)!.stage.span === "five")).toBe(true);
    expect(ids("octave-gf")).toContain("octave-c");
    expect(ids("octave-gf")).toContain("five-core");
  });
});

describe("projectProgress", () => {
  it("opens only the first stage's intro at the start, and the stage once it's done", () => {
    const start = projectProgress([]).treble.stages[first];
    expect(start).toMatchObject({ introOpen: true, introDone: false, unlocked: false });
    expect(start.tierOpen).toEqual({ read: false, play: false, mix: false, fluent: false });
    expect(projectProgress([]).treble.currentStageId).toBe(first);

    const progress = projectProgress([introDone(first)]);
    expect(progress.treble.stages[first].unlocked).toBe(true);
    expect(progress.treble.stages[first].tierOpen).toEqual({ read: true, play: false, mix: false, fluent: false });
    expect(progress.treble.stages[second]).toMatchObject({ introOpen: false, unlocked: false });
    // Notation met in one track is known in the other.
    expect(progress.bass.stages[first].unlocked).toBe(true);
  });

  it("keeps a stage open that was practised before it had an intro", () => {
    const progress = projectProgress([phrase(first, "read", true)]);
    expect(progress.treble.stages[first]).toMatchObject({ introDone: true, unlocked: true });
    expect(progress.bass.stages[first].unlocked).toBe(false);
  });

  it("earns ★ for a streak that has at most one miss in a window", () => {
    const oneMiss = [phrase(first, "read", false), ...repeat(STAR_STREAK - 1, () => phrase(first, "read", true))];
    const stage = projectProgress([introDone(first), ...oneMiss]).treble.stages[first];
    expect(stage.stars).toBe(1);
    expect(stage.tierOpen.play).toBe(true);
  });

  it("breaks a streak on a second miss in a window, back to the phrases since the first", () => {
    const twoMisses = [
      ...repeat(4, () => phrase(first, "read", true)),
      phrase(first, "read", false),
      ...repeat(3, () => phrase(first, "read", true)),
      phrase(first, "read", false),
      ...repeat(4, () => phrase(first, "read", true)),
    ];
    const tier = projectProgress(twoMisses).treble.stages[first].tiers.read;
    expect(tier.streak).toBe(8);
    expect(tier.best).toBe(8);
    // The count the player sees is plain: clean phrases out of the last ten.
    expect(recentHits(tier.recent)).toBe(8);
    expect(tier.recent).toHaveLength(MISS_WINDOW);
    expect(projectProgress(twoMisses).treble.stages[first].stars).toBe(0);
  });

  it("forgives a miss again once the last one is a window behind", () => {
    const spaced = [
      phrase(first, "read", false),
      ...repeat(MISS_WINDOW - 1, () => phrase(first, "read", true)),
      phrase(first, "read", false),
    ];
    expect(projectProgress(spaced).treble.stages[first].tiers.read.streak).toBe(MISS_WINDOW + 1);
  });

  it("opens 1.2's intro at ★★ on 1.1, which has nothing to mix, then the stage once it's done", () => {
    const events = [
      introDone(first),
      ...repeat(STAR_STREAK, () => phrase(first, "read", true)),
      ...repeat(STAR_STREAK, () => phrase(first, "play", true)),
    ];
    const progress = projectProgress(events);
    expect(progress.treble.stages[first].stars).toBe(2);
    expect(progress.treble.stages[first].tierOpen).toMatchObject({ mix: false, fluent: true });
    expect(progress.treble.stages[second]).toMatchObject({ introOpen: true, unlocked: false });
    expect(progress.treble.currentStageId).toBe(second);
    expect(progress.bass.stages[second].introOpen).toBe(false);

    const after = projectProgress([...events, introDone(second)]);
    expect(after.treble.stages[second].unlocked).toBe(true);
  });

  it("opens the next stage only at ★★★ Mix on a stage with earlier ones to mix", () => {
    const twoStars = [
      introDone(first),
      ...repeat(STAR_STREAK, () => phrase(first, "read", true)),
      ...repeat(STAR_STREAK, () => phrase(first, "play", true)),
      introDone(second),
      ...repeat(STAR_STREAK, () => phrase(second, "read", true)),
      ...repeat(STAR_STREAK, () => phrase(second, "play", true)),
    ];
    const clean = projectProgress(twoStars);
    expect(clean.treble.stages[second].tierOpen).toMatchObject({ mix: true, fluent: false });
    expect(clean.treble.stages[third].introOpen).toBe(false);
    expect(clean.treble.currentStageId).toBe(second);

    const mixed = projectProgress([...twoStars, ...repeat(STAR_STREAK, () => phrase(second, "mix", true))]);
    expect(mixed.treble.stages[second].stars).toBe(3);
    expect(mixed.treble.stages[third].introOpen).toBe(true);
    expect(mixed.treble.currentStageId).toBe(third);
  });

  it("ignores screen-keyboard phrases: they neither count nor break a streak", () => {
    const events = [
      ...repeat(5, () => phrase(first, "read", true)),
      phrase(first, "read", false, "screen"),
      phrase(first, "read", true, "mixed"),
      ...repeat(5, () => phrase(first, "read", true)),
    ];
    const tier = projectProgress(events).treble.stages[first].tiers.read;
    expect(tier.streak).toBe(10);
    expect(tier.attempts).toBe(10);
  });

  it("masters a stage with rounds of 9/10 at Fluent after every star, starting over on a weak round", () => {
    const allStars = [
      ...repeat(STAR_STREAK, () => phrase(first, "read", true)),
      ...repeat(STAR_STREAK, () => phrase(first, "play", true)),
      ...repeat(STAR_STREAK, () => phrase(first, "fluent", true)),
    ];
    const round = (misses: number) => [
      ...repeat(misses, () => phrase(first, "fluent", false)),
      ...repeat(MISS_WINDOW - misses, () => phrase(first, "fluent", true)),
    ];
    const almost = [...allStars, ...round(1), ...round(0), ...round(2), ...round(0)];
    const stage = projectProgress(almost).treble.stages[first];
    expect(stage.tiers.fluent.rounds).toBe(1);
    expect(stage.mastered).toBe(false);

    const done = [...almost, ...Array.from({ length: MASTERY_ROUNDS - 1 }, () => round(1)).flat()];
    const mastered = projectProgress(done);
    expect(mastered.treble.stages[first].mastered).toBe(true);
    expect(mastered.treble.mastered).toBe(1);
    expect(milestoneBetween(projectProgress(done.slice(0, -1)), mastered, "treble", first)).toEqual({ kind: "mastered", stars: 3 });
  });

  it("dates each star by the phrase that earned it, and mastery by the round that completed it", () => {
    const read = repeat(STAR_STREAK, () => phrase(first, "read", true));
    const play = repeat(STAR_STREAK, () => phrase(first, "play", true));
    const fluent = repeat(STAR_STREAK, () => phrase(first, "fluent", true));
    const rounds = repeat(MISS_WINDOW * MASTERY_ROUNDS, () => phrase(first, "fluent", true));
    const stage = projectProgress([...read, ...play, phrase(first, "read", false), ...fluent, ...rounds]).treble.stages[first];
    expect(stage.starredAt).toEqual([read.at(-1)!.at, play.at(-1)!.at, fluent.at(-1)!.at]);
    expect(stage.masteredAt).toBe(rounds.at(-1)!.at);
  });

  it("dates a star no earlier than the one before it", () => {
    const play = repeat(STAR_STREAK, () => phrase(first, "play", true));
    const read = repeat(STAR_STREAK, () => phrase(first, "read", true));
    const stage = projectProgress([...play, ...read]).treble.stages[first];
    expect(stage.starredAt).toEqual([read.at(-1)!.at, read.at(-1)!.at]);
  });

  it("counts no mastery rounds at Play", () => {
    const events = [
      ...repeat(STAR_STREAK, () => phrase(first, "read", true)),
      ...repeat(STAR_STREAK * 10, () => phrase(first, "play", true)),
    ];
    expect(projectProgress(events).treble.stages[first].tiers.fluent.rounds).toBe(0);
  });

  it("keeps a Fluent streak earned before Mix existed, counting it once Mix is earned", () => {
    const old = [
      introDone(first),
      ...repeat(STAR_STREAK, () => phrase(first, "read", true)),
      ...repeat(STAR_STREAK, () => phrase(first, "play", true)),
      introDone(second),
      ...repeat(STAR_STREAK, () => phrase(second, "read", true)),
      ...repeat(STAR_STREAK, () => phrase(second, "play", true)),
      ...repeat(STAR_STREAK, () => phrase(second, "fluent", true)),
    ];
    expect(projectProgress(old).treble.stages[second].stars).toBe(2);
    const mixed = projectProgress([...old, ...repeat(STAR_STREAK, () => phrase(second, "mix", true))]);
    expect(mixed.treble.stages[second].stars).toBe(4);
  });

  it("ignores custom practice and unknown stages", () => {
    const custom = { ...phrase(first, "read", true), context: { kind: "custom" as const } };
    const events = [...repeat(20, () => custom), ...repeat(20, () => phrase("gone", "read", true))];
    expect(projectProgress(events).treble.stages[first].tiers.read.attempts).toBe(0);
  });

  it("opens every stage up to where the track was started, without stars", () => {
    const start = PLACED_STAGES[5].stage.id;
    const progress = projectProgress([
      { type: "track-started", v: 1, id: "t", at: ++clock, session: "s", clef: "treble", stageId: start },
    ]);
    const track = progress.treble;
    expect(PLACED_STAGES.slice(0, 6).every((p) => track.stages[p.stage.id].unlocked || track.stages[p.stage.id].introOpen)).toBe(true);
    expect(track.stages[PLACED_STAGES[6].stage.id].unlocked).toBe(false);
    expect(track.passed).toBe(0);
    expect(track.currentStageId).toBe(start);
    expect(progress.bass.stages[second].unlocked).toBe(false);
  });

  it("opens everything with unlockAll, keeping earned stars", () => {
    const progress = unlockAll(projectProgress([introDone(first), ...repeat(STAR_STREAK, () => phrase(first, "read", true))]));
    const last = progress.treble.stages[PLACED_STAGES[PLACED_STAGES.length - 1].stage.id];
    expect(last.unlocked && last.tierOpen.fluent).toBe(true);
    expect(progress.treble.stages[first].stars).toBe(1);
  });

  it("reports the star that opened the next stage, or its intro", () => {
    const opening = (stageId: string, done: IntroCompleted[]) => {
      const base = [
        ...done,
        ...repeat(STAR_STREAK, () => phrase(stageId, "read", true)),
        ...repeat(STAR_STREAK - 1, () => phrase(stageId, "play", true)),
      ];
      return milestoneBetween(projectProgress(base), projectProgress([...base, phrase(stageId, "play", true)]), "treble", stageId);
    };
    expect(opening(first, [introDone(first)])).toEqual({ kind: "star", stars: 2, openedStageId: second, openedIntro: true });
    // A replayed intro (done before) opens the stage itself.
    expect(opening(first, [introDone(first), introDone(second)])).toEqual({ kind: "star", stars: 2, openedStageId: second });
  });
});

describe("firstFault", () => {
  it("names the bar of the first imperfect note", () => {
    const event = phrase(first, "read", true);
    event.barSizes = [2, 2];
    event.notes = [
      ...event.notes,
      { pitch: "E4", duration: "h", wrong: 0, hit: false },
      { pitch: "C4", duration: "h", wrong: 0, hit: true },
    ];
    expect(firstFault(event)).toEqual({ kind: "missed", bar: 2, index: 2 });
  });

  it("calls a note spoiled only by early presses early, and any wrong key wrong", () => {
    const event = phrase(first, "read", true);
    event.notes = [{ pitch: "C4", duration: "q", wrong: 1, early: 1, hit: true }, ...event.notes.slice(1)];
    expect(firstFault(event)).toMatchObject({ kind: "early", index: 0 });
    event.notes[0] = { ...event.notes[0], wrong: 2 };
    expect(firstFault(event)).toMatchObject({ kind: "wrong", index: 0 });
  });
});

describe("minor keys", () => {
  it("derives relative minor ids with the major's signature", () => {
    expect(MINOR_KEYS.map((k) => k.id)).toEqual([
      "Am", "Em", "Bm", "F#m", "C#m", "G#m", "D#m", "A#m", "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm", "Abm",
    ]);
    expect(keyById("F#m")).toMatchObject({ mode: "minor", tonic: "F", signature: 3 });
  });

  it("starts minor spans on the minor tonic", () => {
    const am = spanLevel("treble", "Am", "five");
    expect([am.lowest, am.highest].map((s) => `${s.letter}${s.octave}`)).toEqual(["A4", "E5"]);
    expect(spanLevel("treble", "F#m", "five").lowest).toMatchObject({ letter: "F", alter: 1 });
  });

  it("ends minor phrases on the tonic and raises the 7th into it", () => {
    const random = seeded(3);
    let leadingTones = 0;
    for (let i = 0; i < 40; i++) {
      const notes = generateExercise(spanLevel("treble", "Am", "octave"), {
        bars: 4,
        key: "Am",
        accidentalFrequency: "none",
        rhythm: "basic",
      }, random).bars.flat();
      expect(notes[notes.length - 1].letter).toBe("A");
      notes.forEach((note, j) => {
        if (note.letter !== "G") return;
        const next = notes[j + 1];
        const stepsUpToA = next?.letter === "A" && next.octave === note.octave;
        expect(note.alter).toBe(stepsUpToA ? 1 : 0);
        if (stepsUpToA) leadingTones++;
      });
    }
    expect(leadingTones).toBeGreaterThan(0);
  });

  it("writes the mode into MusicXML", () => {
    const exercise = generateExercise(spanLevel("bass", "Dm", "five"), {
      bars: 1,
      key: "Dm",
      accidentalFrequency: "none",
      rhythm: "basic",
    }, seeded(1));
    expect(exerciseToMusicXml(exercise)).toContain("<fifths>-1</fifths>\n          <mode>minor</mode>");
  });

  it("names mixed key sets compactly", () => {
    const titles = PLACED_STAGES.map((p) => stageTitle(p.stage));
    expect(titles).toContain("One octave · C G F D + minors");
    expect(titles).toContain("One octave · B♭ Gm");
  });
});
