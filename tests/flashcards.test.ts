import { describe, expect, it } from "vitest";
import { placedStage, PLACED_STAGES, STAR_STREAK, stageTiers, type Tier } from "../src/curriculum/curriculum";
import { cardNoteHits, cardOutcome, type CardAnswered, type IntroCompleted, type PhraseCompleted } from "../src/curriculum/events";
import { MemoryEventLog } from "../src/curriculum/eventLog";
import { projectProgress } from "../src/curriculum/progress";
import { ProgressStore } from "../src/curriculum/progressStore";
import { spanLevel } from "../src/curriculum/spans";
import { ALL_CONCEPTS, CONCEPTS, conceptById, conceptId, unlockedConcepts } from "../src/flashcards/concepts";
import { CARD_NOTES, generateCard, MAX_WINDOW_KEYS, MIN_WINDOW_KEYS } from "../src/flashcards/cardGenerator";
import { EMPTY_ENTRY, placesByPitch, press } from "../src/flashcards/entry";
import {
  answer,
  buildQueue,
  dayNumber,
  dayStart,
  dueCounts,
  LEARN_AHEAD_MS,
  LEARNING_STEPS_MIN,
  MIN_EASE,
  NEW_PER_DAY,
  nextCard,
  RELEARNING_STEPS_MIN,
  scheduleConcepts,
  START_EASE,
  type Schedule,
} from "../src/flashcards/scheduler";
import { exerciseToMusicXml } from "../src/music/musicXml";
import { keyAlter, keyById } from "../src/music/keys";
import { isBlackKey, midiOf, staffStep } from "../src/music/pitch";
import type { Clef } from "../src/music/types";
import { seeded } from "./helpers";

const MIN = 60_000;
const at = (day: number, hour = 12, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();

let clock = 0;

function intro(stageId: string, clef: Clef = "treble"): IntroCompleted {
  return { type: "intro-completed", v: 1, id: `i${clock}`, at: ++clock, session: "s", clef, stageId, skipped: false };
}

function phrase(stageId: string, tier: Tier, clef: Clef = "treble"): PhraseCompleted {
  return {
    type: "phrase-completed",
    v: 1,
    id: `p${clock}`,
    at: ++clock,
    session: "s",
    context: { kind: "curriculum", clef, stageId, tier },
    mode: tier === "read" ? "wait" : "rhythm",
    input: "midi",
    config: { clef, key: "C", lowest: "C4", highest: "G4", accidentals: "none", rhythm: "basic", bars: 1 },
    barSizes: [1],
    notes: [{ pitch: "C4", duration: "w", wrong: 0, hit: true }],
  };
}

/** Enough clean phrases at the stage's own tiers to pass it. */
function clear(stageId: string, clef: Clef = "treble"): PhraseCompleted[] {
  const { stage } = placedStage(stageId)!;
  const tiers = stageTiers(stage);
  const needed = tiers.slice(0, tiers.includes("mix") ? tiers.indexOf("mix") + 1 : tiers.indexOf("play") + 1);
  return needed.flatMap((tier) => Array.from({ length: STAR_STREAK }, () => phrase(stageId, tier, clef)));
}

function card(overrides: Partial<CardAnswered> = {}): CardAnswered {
  return {
    type: "card-answered",
    v: 1,
    id: `c${clock}`,
    at: ++clock,
    startedAt: clock - 1,
    session: "s",
    concept: "treble/C/five",
    clef: "treble",
    key: "C",
    time: "4/4",
    notes: ["C4", "E4", "D4", "G4"],
    answer: [60, 64, 62, 67],
    input: "screen",
    ...overrides,
  };
}

describe("cardOutcome", () => {
  it("is correct only when every note is in its place", () => {
    expect(cardOutcome(card())).toBe("correct");
    expect(cardNoteHits(card({ answer: [60, 62, 64, 67] }))).toEqual([true, false, false, true]);
    expect(cardOutcome(card({ answer: [60, 62, 64, 67] }))).toBe("wrong");
  });

  it("counts notes left out as missed", () => {
    expect(cardNoteHits(card({ answer: [60, 64] }))).toEqual([true, true, false, false]);
    expect(cardOutcome(card({ answer: [60, 64] }))).toBe("wrong");
  });

  it("reads a blank answer as not knowing", () => {
    expect(cardOutcome(card({ answer: [] }))).toBe("unknown");
  });

  it("grades by key, so an accidental is the same key however it is spelled", () => {
    expect(cardOutcome(card({ notes: ["F#4", "Gb4"], answer: [66, 66] }))).toBe("correct");
  });
});

describe("concepts", () => {
  it("are unique and start from the first stage's key and range", () => {
    const ids = ALL_CONCEPTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CONCEPTS.treble[0]).toMatchObject({ id: "treble/C/five", stageId: PLACED_STAGES[0].stage.id, accidentals: false });
    expect(CONCEPTS.bass[0].id).toBe("bass/C/five");
  });

  it("can be looked up by id, and each is tied to a real stage", () => {
    for (const concept of ALL_CONCEPTS) {
      expect(conceptById(concept.id)).toBe(concept);
      expect(placedStage(concept.stageId)).toBeDefined();
      expect(concept.id).toBe(conceptId(concept.clef, concept.key, concept.span, concept.accidentals));
    }
  });

  it("has accidentals only from the first stage that has them", () => {
    const first = CONCEPTS.treble.find((c) => c.accidentals)!;
    expect(placedStage(first.stageId)!.stage.accidentals).not.toBe("none");
    const earlier = PLACED_STAGES.filter((p) => p.order < placedStage(first.stageId)!.order);
    expect(earlier.every((p) => p.stage.accidentals === "none")).toBe(true);
  });

  it("are all closed to a player who hasn't started", () => {
    expect(unlockedConcepts(projectProgress([]))).toEqual([]);
  });

  it("open for a key when its intro is done, as the intro counts in either clef", () => {
    const [five, fiveG] = PLACED_STAGES.map((p) => p.stage.id);
    const progress = projectProgress([intro(five)]);
    expect(unlockedConcepts(progress).map((c) => c.id)).toEqual(["treble/C/five", "bass/C/five"]);
    const both = projectProgress([intro(five), intro(fiveG)]);
    expect(unlockedConcepts(both).map((c) => c.id)).toEqual(["treble/C/five", "treble/G/five", "bass/C/five", "bass/G/five"]);
  });

  it("stay closed for a stage with no intro until it is cleared", () => {
    const octaveC = PLACED_STAGES.find((p) => p.stage.id === "octave-c")!.stage;
    expect(octaveC.introduces).toEqual([]);
    const watched = projectProgress([intro("five-c")]);
    expect(unlockedConcepts(watched).some((c) => c.id === "treble/C/octave")).toBe(false);
    const cleared = projectProgress([intro("five-c"), ...clear("octave-c")]);
    expect(unlockedConcepts(cleared).some((c) => c.id === "treble/C/octave")).toBe(true);
    // Clearing a stage is per clef.
    expect(unlockedConcepts(cleared).some((c) => c.id === "bass/C/octave")).toBe(false);
  });

  it("opens everything for the debug unlock", () => {
    expect(unlockedConcepts(projectProgress([]), true)).toHaveLength(ALL_CONCEPTS.length);
  });
});

describe("dayNumber", () => {
  it("turns the day over at 4 in the morning", () => {
    expect(dayNumber(at(5, 3, 59))).toBe(dayNumber(at(4, 12)));
    expect(dayNumber(at(5, 4, 0))).toBe(dayNumber(at(4, 12)) + 1);
  });

  it("counts calendar days across a clock change", () => {
    expect(dayNumber(new Date(2026, 9, 26, 12).getTime()) - dayNumber(new Date(2026, 9, 24, 12).getTime())).toBe(2);
  });

  it("starts a day at the turnover", () => {
    expect(dayStart(dayNumber(at(5, 12)))).toBe(at(5, 4));
  });
});

describe("answer", () => {
  const now = at(4);

  it("walks a new concept through the learning steps and graduates it to a day", () => {
    const first = answer(undefined, true, now);
    expect(first).toMatchObject({ phase: "learning", step: 1, dueAt: now + LEARNING_STEPS_MIN[1] * MIN, reps: 1 });
    const second = answer(first, true, now + 10 * MIN);
    expect(second).toMatchObject({ phase: "review", intervalDays: 1, ease: START_EASE, dueDay: dayNumber(now) + 1 });
  });

  it("sends a miss back to the first step, minutes away", () => {
    const first = answer(undefined, true, now);
    expect(answer(first, false, now + 10 * MIN)).toMatchObject({ phase: "learning", step: 0, dueAt: now + 11 * MIN });
    expect(answer(undefined, false, now)).toMatchObject({ phase: "learning", step: 0, dueAt: now + MIN });
  });

  it("grows a review's interval by its ease", () => {
    let schedule = answer(answer(undefined, true, now), true, now);
    const intervals: number[] = [];
    for (let day = 1; intervals.length < 4; day++) {
      schedule = answer(schedule, true, at(4 + day));
      intervals.push(schedule.intervalDays);
    }
    expect(intervals).toEqual([3, 8, 20, 50]);
    expect(schedule.dueDay).toBe(dayNumber(at(8)) + 50);
  });

  it("takes a miss in review back to relearning, with less ease and the shortest interval", () => {
    const reviewing: Schedule = { ...answer(answer(undefined, true, now), true, now), intervalDays: 20, dueDay: dayNumber(now) };
    const lapsed = answer(reviewing, false, now);
    expect(lapsed).toMatchObject({ phase: "relearning", step: 0, intervalDays: 1, lapses: 1, dueAt: now + RELEARNING_STEPS_MIN[0] * MIN });
    expect(lapsed.ease).toBeCloseTo(START_EASE - 0.2);
    const back = answer(lapsed, true, now + 10 * MIN);
    expect(back).toMatchObject({ phase: "review", intervalDays: 1, dueDay: dayNumber(now) + 1 });
  });

  it("never lets the ease fall below its floor", () => {
    let schedule: Schedule = { ...answer(answer(undefined, true, now), true, now), intervalDays: 5 };
    for (let i = 0; i < 12; i++) {
      schedule = answer({ ...schedule, phase: "review" }, false, now);
    }
    expect(schedule.ease).toBe(MIN_EASE);
  });
});

describe("scheduleConcepts", () => {
  it("folds card answers in the order given, per concept", () => {
    const events = [
      card({ concept: "treble/C/five", at: 3_000, answer: [] }),
      card({ concept: "treble/C/five", at: 1_000 }),
      card({ concept: "treble/G/five", at: 2_000 }),
      phrase("five-c", "read"),
    ];
    const schedules = scheduleConcepts(events);
    expect([...schedules.keys()].sort()).toEqual(["treble/C/five", "treble/G/five"]);
    // Right, then "I don't know": back to the first step.
    expect(schedules.get("treble/C/five")).toMatchObject({ phase: "learning", step: 0, reps: 2 });
    expect(schedules.get("treble/G/five")).toMatchObject({ phase: "learning", step: 1, reps: 1 });
  });
});

describe("ProgressStore", () => {
  it("loads answers back, so the schedule survives a reload", async () => {
    const log = new MemoryEventLog();
    await log.append(card());
    const store = new ProgressStore(Promise.resolve(log));
    await new Promise<void>((resolve) => store.subscribe(resolve));
    expect(scheduleConcepts(store.history).has(card().concept)).toBe(true);
  });
});

describe("the queue", () => {
  const unlocked = CONCEPTS.treble.slice(0, 6);
  const now = at(4);

  it("brings in only today's quota of new concepts, earliest first", () => {
    const queue = buildQueue(unlocked, new Map(), now);
    expect(queue.fresh.map((c) => c.id)).toEqual(unlocked.slice(0, NEW_PER_DAY).map((c) => c.id));
    expect(nextCard(queue)).toMatchObject({ kind: "new", concept: unlocked[0] });
    expect(dueCounts(queue)).toEqual({ new: NEW_PER_DAY, learning: 0, review: 0, total: NEW_PER_DAY });
  });

  it("counts concepts met today against the quota, and starts again the next day", () => {
    const schedules = new Map([[unlocked[0].id, answer(undefined, true, now)]]);
    expect(buildQueue(unlocked, schedules, now).fresh).toHaveLength(NEW_PER_DAY - 1);
    expect(buildQueue(unlocked, schedules, at(5)).fresh).toHaveLength(NEW_PER_DAY);
  });

  it("puts tries due first, then reviews, then new ones", () => {
    const [a, b, c] = unlocked;
    const learning = answer(undefined, false, now - 5 * MIN);
    const review: Schedule = { ...answer(answer(undefined, true, at(2)), true, at(2)), dueDay: dayNumber(now) - 1 };
    const schedules = new Map([[a.id, review], [b.id, learning]]);
    const queue = buildQueue([a, b, c], schedules, now);
    expect(queue.learning).toEqual([b]);
    expect(queue.reviews).toEqual([a]);
    expect(queue.fresh).toEqual([c]);
    expect(nextCard(queue)).toMatchObject({ kind: "learning", concept: b });
    expect(dueCounts(queue).total).toBe(3);
  });

  it("holds back reviews that aren't due, and says when the next comes", () => {
    const review: Schedule = { ...answer(answer(undefined, true, now), true, now), dueDay: dayNumber(now) + 3 };
    const queue = buildQueue([unlocked[0]], new Map([[unlocked[0].id, review]]), now);
    expect(queue.reviews).toEqual([]);
    expect(nextCard(queue)).toBeNull();
    expect(queue.nextAt).toBe(dayStart(dayNumber(now) + 3));
  });

  it("brings a try forward when nothing else is up, but only if it is soon", () => {
    const soon = answer(undefined, false, now);
    const queue = buildQueue([unlocked[0]], new Map([[unlocked[0].id, soon]]), now);
    expect(queue.learning).toEqual([]);
    expect(nextCard(queue)).toMatchObject({ kind: "learning", concept: unlocked[0] });
    const later = buildQueue([unlocked[0]], new Map([[unlocked[0].id, soon]]), now - LEARN_AHEAD_MS);
    expect(nextCard(later)).toBeNull();
    expect(later.nextAt).toBe(soon.dueAt);
  });

  it("skips concepts that aren't unlocked", () => {
    const schedules = new Map([[unlocked[1].id, answer(undefined, false, now - 5 * MIN)]]);
    expect(buildQueue([unlocked[0]], schedules, now).learning).toEqual([]);
  });
});

describe("entering an answer", () => {
  it("numbers keys in the order they were pressed", () => {
    let entry = EMPTY_ENTRY;
    for (const pitch of [64, 60, 67]) entry = press(entry, pitch, 4).entry;
    expect([...placesByPitch(entry)]).toEqual([[64, 1], [60, 2], [67, 3]]);
  });

  it("takes a key out again when it is pressed a second time, and the rest move up", () => {
    let entry = EMPTY_ENTRY;
    for (const pitch of [64, 60, 67]) entry = press(entry, pitch, 4).entry;
    const result = press(entry, 60, 4);
    expect(result.change).toBe("removed");
    expect([...placesByPitch(result.entry)]).toEqual([[64, 1], [67, 2]]);
  });

  it("takes no more keys than the bar has notes", () => {
    let entry = EMPTY_ENTRY;
    for (const pitch of [60, 62, 64, 65]) entry = press(entry, pitch, 4).entry;
    const result = press(entry, 67, 4);
    expect(result.change).toBe("full");
    expect(result.entry).toBe(entry);
  });
});

describe("generateCard", () => {
  const random = seeded(7);

  it("makes four different quarter notes in one bar of 4/4, in the concept's key and clef", () => {
    for (const concept of ALL_CONCEPTS) {
      const { exercise, pitches } = generateCard(concept, 10, random);
      expect(exercise).toMatchObject({ clef: concept.clef, key: concept.key, time: "4/4", pickup: 0 });
      expect(exercise.bars).toHaveLength(1);
      expect(exercise.bars[0]).toHaveLength(CARD_NOTES);
      expect(exercise.bars[0].every((n) => n.duration === "q")).toBe(true);
      expect(new Set(pitches).size).toBe(CARD_NOTES);
      expect(pitches).toEqual(exercise.bars[0].map(midiOf));
      const positions = exercise.bars[0].map((n) => staffStep(n));
      expect(new Set(positions).size).toBe(CARD_NOTES);
    }
  });

  it("keeps every note inside the range, and the keys drawn from white key to white key around them", () => {
    for (const concept of ALL_CONCEPTS) {
      for (const keys of [6, 9, 15, 30]) {
        const { exercise, window, pitches } = generateCard(concept, keys, random);
        const level = spanLevel(concept.clef, concept.key, concept.span);
        const [low, high] = [staffStep(level.lowest), staffStep(level.highest)];
        for (const note of exercise.bars[0]) {
          expect(staffStep(note)).toBeGreaterThanOrEqual(low);
          expect(staffStep(note)).toBeLessThanOrEqual(high);
        }
        expect(isBlackKey(window.lowest) || isBlackKey(window.highest)).toBe(false);
        for (const pitch of pitches) {
          expect(pitch).toBeGreaterThanOrEqual(window.lowest);
          expect(pitch).toBeLessThanOrEqual(window.highest);
        }
      }
    }
  });

  it("draws a window of the same width every time, as wide as the screen allows within limits", () => {
    const whiteKeys = (w: { lowest: number; highest: number }) =>
      Array.from({ length: w.highest - w.lowest + 1 }, (_, i) => w.lowest + i).filter((m) => !isBlackKey(m)).length;
    const concept = conceptById("treble/C/two-octaves") ?? ALL_CONCEPTS.find((c) => c.span === "two-octaves")!;
    for (let i = 0; i < 30; i++) expect(whiteKeys(generateCard(concept, 9, random).window)).toBe(9);
    expect(whiteKeys(generateCard(concept, 3, random).window)).toBe(MIN_WINDOW_KEYS);
    expect(whiteKeys(generateCard(concept, 40, random).window)).toBe(MAX_WINDOW_KEYS);
  });

  it("is plain for a concept without accidentals and has some for one with", () => {
    for (const concept of ALL_CONCEPTS) {
      const key = keyById(concept.key);
      for (let i = 0; i < 20; i++) {
        const accidentals = generateCard(concept, 12, random).exercise.bars[0].filter((n) => n.alter !== keyAlter(key, n.letter));
        if (concept.accidentals) {
          expect(accidentals.length).toBeGreaterThanOrEqual(1);
          expect(accidentals.length).toBeLessThanOrEqual(2);
        } else {
          expect(accidentals).toHaveLength(0);
        }
      }
    }
  });

  it("reaches every line and space of the range over many cards", () => {
    const concept = conceptById("treble/C/octave")!;
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) for (const n of generateCard(concept, 9, random).exercise.bars[0]) seen.add(staffStep(n));
    expect(seen.size).toBe(8);
  });

  it("can be drawn as notation", () => {
    for (const concept of ALL_CONCEPTS.filter((_, i) => i % 7 === 0)) {
      expect(exerciseToMusicXml(generateCard(concept, 10, random).exercise, { noteNames: false })).toContain("<note");
    }
  });
});
