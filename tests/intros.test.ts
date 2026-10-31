import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLEF_TRACKS, hasIntro, PLACED_STAGES, placedStage, stageNewKeys, stageNotations } from "../src/curriculum/curriculum";
import { introMidiRange, introSteps } from "../src/curriculum/intros";
import { introsSeen, projectProgress } from "../src/curriculum/progress";
import type { IntroCompleted } from "../src/curriculum/events";
import { parseBank } from "../src/music/corpus";
import { notationsOf, usesOnly } from "../src/music/notation";
import { midiOf } from "../src/music/pitch";
import { barBeats, BEATS } from "../src/music/rhythms";
import { stageMidiRange } from "../src/curriculum/corpusSource";
import { seeded } from "./helpers";

const corpus = parseBank(JSON.parse(readFileSync("public/phrases.json", "utf8")));

describe("introSteps", () => {
  const introStages = PLACED_STAGES.filter((p) => hasIntro(p.stage));

  it("gives every introducing stage a whole example per notation and a scale per new key, then a real phrase", () => {
    for (const clef of CLEF_TRACKS) {
      for (const { stage } of introStages) {
        const steps = introSteps(corpus, clef, stage, seeded(1));
        const newKeys = stageNewKeys(stage);
        expect(steps.length).toBeGreaterThanOrEqual(stage.introduces.length + newKeys.length);
        const range = introMidiRange(steps, stageMidiRange(corpus, clef, stage));
        const allowed = stageNotations(stage);
        for (const [i, { exercise }] of steps.entries()) {
          const scaleIndex = i - stage.introduces.length;
          if (i < stage.introduces.length) expect(exercise.key).toBe(stage.keys[0]);
          else if (scaleIndex < newKeys.length) expect(exercise.key).toBe(newKeys[scaleIndex]);
          else expect(exercise.key).toBe(newKeys[0] ?? stage.keys[0]);
          const used = notationsOf(exercise.time, exercise.pickup, exercise.bars);
          // An example uses nothing the stage hasn't introduced, and shows its own notation.
          expect(usesOnly(used, allowed)).toBe(true);
          if (i < stage.introduces.length) expect(used.has(stage.introduces[i])).toBe(true);
          if (scaleIndex >= 0 && scaleIndex < newKeys.length) {
            const pitches = exercise.bars.flat().map(midiOf);
            expect(pitches).toHaveLength(15);
            expect(pitches[7] - pitches[0]).toBe(12);
            expect(pitches[14]).toBe(pitches[0]);
          }
          const [pickupBar, ...rest] = exercise.pickup > 0 ? exercise.bars : [null, ...exercise.bars];
          if (pickupBar) expect(pickupBar.reduce((s, n) => s + BEATS[n.duration], 0)).toBe(exercise.pickup);
          for (const bar of rest.slice(0, -1)) expect(bar!.reduce((s, n) => s + BEATS[n.duration], 0)).toBe(barBeats(exercise.time));
          for (const note of exercise.bars.flat()) {
            expect(midiOf(note)).toBeGreaterThanOrEqual(range.lowest);
            expect(midiOf(note)).toBeLessThanOrEqual(range.highest);
          }
        }
      }
    }
  });

  it("has nothing for a stage that introduces nothing", () => {
    expect(introSteps(corpus, "treble", placedStage("octave-c")!.stage)).toEqual([]);
  });

  it("introduces each key once, with a raised 7th in minor", () => {
    const newKeys = PLACED_STAGES.flatMap((p) => stageNewKeys(p.stage));
    expect(new Set(newKeys).size).toBe(newKeys.length);
    expect(new Set(newKeys)).toEqual(new Set(PLACED_STAGES.flatMap((p) => p.stage.keys)));
    const am = introSteps(corpus, "treble", placedStage("five-am")!.stage).find((s) => s.title === "The A minor scale")!;
    expect(am.exercise.bars.flat().map((n) => `${n.letter}${n.alter === 1 ? "#" : ""}`).slice(0, 8)).toEqual(
      ["A", "B", "C", "D", "E", "F", "G#", "A"],
    );
    expect(am.text).toContain("G\u266F");
  });
});

describe("introsSeen", () => {
  it("collects intros watched or skipped, in either track", () => {
    const event = (stageId: string, skipped: boolean): IntroCompleted => ({
      type: "intro-completed", v: 1, id: stageId, at: 1, session: "s", clef: "bass", stageId, skipped,
    });
    const events = [event("five-c", false), event("five-g", true)];
    expect([...introsSeen(events)].sort()).toEqual(["five-c", "five-g"]);
    expect(projectProgress(events).treble.stages["five-g"]).toMatchObject({ introDone: true, unlocked: false });
  });
});
