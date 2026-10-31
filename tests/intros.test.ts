import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLEF_TRACKS, PLACED_STAGES, placedStage, stageNotations } from "../src/curriculum/curriculum";
import { introSteps } from "../src/curriculum/intros";
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
  const introStages = PLACED_STAGES.filter((p) => p.stage.introduces.length > 0);

  it("gives every introducing stage a whole example per notation, then a real phrase", () => {
    for (const clef of CLEF_TRACKS) {
      for (const { stage } of introStages) {
        const steps = introSteps(corpus, clef, stage, seeded(1));
        expect(steps.length).toBeGreaterThanOrEqual(stage.introduces.length);
        const range = stageMidiRange(corpus, clef, stage);
        const allowed = stageNotations(stage);
        for (const [i, { exercise }] of steps.entries()) {
          expect(exercise.key).toBe(stage.keys[0]);
          const used = notationsOf(exercise.time, exercise.pickup, exercise.bars);
          // An example uses nothing the stage hasn't introduced, and shows its own notation.
          expect(usesOnly(used, allowed)).toBe(true);
          if (i < stage.introduces.length) expect(used.has(stage.introduces[i])).toBe(true);
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
    expect(introSteps(corpus, "treble", placedStage("five-f")!.stage)).toEqual([]);
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
