import { describe, expect, it } from "vitest";
import type { Piece, PieceMeasure, PieceNote } from "../src/piece/piece";
import {
  defaultSettings,
  nextPlace,
  normalizeSettings,
  phrasesOf,
  recordPass,
  stepsFor,
  stepTempo,
  streakMet,
  withStep,
  type PieceProgress,
} from "../src/piece/pieceProgress";
import { PieceSession } from "../src/piece/pieceSession";
import { barRange, clipSpan, onsets, playSpan } from "../src/piece/targets";

const BAR: PieceMeasure = { label: "1", start: 0, length: 4, beats: 4, time: "4/4", fifths: 0, mode: "major", repeatStart: false, repeatEnd: false, jump: false, clefs: { right: "G2", left: "F4" } };

function n(hand: "left" | "right", midi: number, start: number, length = 1, extra: Partial<PieceNote> = {}): PieceNote {
  const measure = Math.floor(start / 4);
  return { hand, midi, start, length, measure, offset: start - measure * 4, tiedFrom: false, grace: false, chord: false, tuplet: false, ...extra };
}

/** Two bars: a right-hand line over left-hand chords on beats 1 and 3. */
function piece(): Piece {
  return {
    title: "Test",
    composer: "",
    tempo: 60,
    measures: [BAR, { ...BAR, label: "2", start: 4 }],
    notes: [
      n("right", 72, 0),
      n("right", 74, 1),
      n("right", 76, 2),
      n("right", 77, 3),
      n("left", 48, 0, 2, { chord: true }),
      n("left", 55, 0, 2, { chord: true }),
      n("left", 48, 2, 2),
      n("right", 79, 4, 4),
    ],
    warnings: [],
  };
}

/** 60 bpm: one quarter beat is 1000 ms; a one-bar count-in. */
function session(hand: "left" | "right" | "both") {
  const span = playSpan(piece(), barRange(0, 1), hand);
  const s = new PieceSession(span, 60, 4);
  s.arm(0);
  return s;
}

/** Presses every target on its beat, give or take `offset` ms. */
function playAll(s: PieceSession, offset = 0) {
  s.targets.forEach((t) => s.play(t.pitch, 4000 + t.due * 1000 + offset));
}

describe("PieceSession", () => {
  it("passes both hands played on time, chords included", () => {
    const s = session("both");
    playAll(s, 40);
    s.tick(20_000);
    expect(s.result()).toMatchObject({ clean: true, hits: 8, total: 8 });
  });

  it("counts a late but accepted note as played", () => {
    const s = session("right");
    playAll(s, 300);
    s.tick(20_000);
    expect(s.result().clean).toBe(true);
    expect(s.stateOf(0)).toBe("late");
  });

  it("fails a missed chord note, naming its bar", () => {
    const s = session("left");
    s.play(48, 4000);
    s.play(48, 6000);
    s.tick(20_000);
    expect(s.result()).toMatchObject({ clean: false, fault: { kind: "missed", slot: 0 } });
  });

  it("ignores the other hand's keys while it's played for you", () => {
    const s = session("right");
    s.play(48, 4000);
    playAll(s);
    s.tick(20_000);
    expect(s.result().clean).toBe(true);
  });

  it("fails a wrong key and a right key played too early", () => {
    const wrong = session("right");
    wrong.play(72, 4000);
    expect(wrong.play(61, 4500).kind).toBe("wrong");
    playAll(wrong);
    wrong.tick(20_000);
    expect(wrong.result().fault?.kind).toBe("wrong");

    const early = session("right");
    expect(early.play(79, 7200).kind).toBe("early");
  });

  it("lets keys be noodled during the count-in", () => {
    const s = session("right");
    expect(s.play(61, 1000).kind).toBe("ignored");
    playAll(s);
    s.tick(20_000);
    expect(s.result().clean).toBe(true);
  });

  it("matches a press to the nearest unplayed note when a key repeats quickly", () => {
    const quick: Piece = { ...piece(), notes: [0, 0.25, 0.5, 0.75].map((t) => n("right", 72, t, 0.25)) };
    const s = new PieceSession(playSpan(quick, [0], "right"), 60, 4);
    s.arm(0);
    // Each sixteenth 100 ms late: still each its own note.
    [0, 250, 500, 750].forEach((t) => expect(s.play(72, 4100 + t)).toMatchObject({ kind: "hit" }));
    s.tick(20_000);
    expect(s.result()).toMatchObject({ clean: true, hits: 4 });
  });

  it("holds a tied note on without a press for its second half", () => {
    const tied: Piece = {
      ...piece(),
      notes: [n("right", 72, 0, 4, { tieNext: 1 }), n("right", 72, 4, 4, { tiedFrom: true })],
    };
    const span = playSpan(tied, [0, 1], "right");
    expect(span.targets).toHaveLength(1);
    expect(span.targets[0]).toMatchObject({ length: 8, notes: [0, 1] });
  });

  it("doesn't grade a trill, and lets its keys be played any way", () => {
    const trilled: Piece = {
      ...piece(),
      notes: [n("right", 72, 0), n("right", 74, 1, 2, { ornament: "trill", upper: 76, lower: 72 }), n("right", 72, 3)],
    };
    const span = playSpan(trilled, [0], "right");
    expect(span.targets.map((t) => t.pitch)).toEqual([72, 72]);
    expect(span.ungraded.map((t) => t.pitch)).toEqual([74]);
    const s = new PieceSession(span, 60, 4);
    s.arm(0);
    s.play(72, 4000);
    // E–D–E–D through beats 2 and 3, and the next C on time.
    [5000, 5120, 5240, 5360, 5480].forEach((t, i) => expect(s.play(i % 2 ? 74 : 76, t).kind).toBe("ignored"));
    s.play(72, 7000);
    s.tick(20_000);
    expect(s.result()).toMatchObject({ clean: true, hits: 2, total: 2 });
  });

  it("plays an appoggiatura on the beat and grades the note after where it then falls", () => {
    const leaning: Piece = {
      ...piece(),
      notes: [n("right", 74, 0, 0, { grace: true, type: "eighth" }), n("right", 72, 0, 2)],
    };
    const span = playSpan(leaning, [0], "right");
    expect(span.targets).toHaveLength(1);
    expect(span.targets[0]).toMatchObject({ due: 0.5, length: 1.5, graces: { notes: [0], lead: 0.5 } });
    const s = new PieceSession(span, 60, 4);
    s.arm(0);
    expect(s.play(74, 4000).kind).toBe("ignored");
    expect(s.play(72, 4500)).toMatchObject({ kind: "hit", timing: "on-time" });
  });
});

describe("piece curriculum", () => {
  it("goes left, right, then both hands, slow before standard", () => {
    expect(stepsFor("slow-first").map((s) => `${s.hand} ${s.speed}`)).toEqual([
      "left slow",
      "left standard",
      "right slow",
      "right standard",
      "both slow",
      "both standard",
    ]);
    expect(stepsFor("standard")).toHaveLength(3);
  });

  it("passes a step at its streak with the misses it allows", () => {
    expect(streakMet([...Array(9).fill(true), false], 10, 1)).toBe(true);
    expect(streakMet([false, ...Array(8).fill(true), false], 10, 1)).toBe(false);
    expect(streakMet(Array(9).fill(true), 10, 1)).toBe(false);
    expect(streakMet([true, false, false, true, true], 5, 2)).toBe(true);
  });

  it("keeps a step passed once it is", () => {
    let progress = undefined;
    for (let i = 0; i < 5; i++) progress = recordPass(progress, true, 5, 0, i);
    expect(progress!.passedAt).toBe(4);
    progress = recordPass(progress, false, 5, 0, 9);
    expect(progress.passedAt).toBe(4);
  });

  it("moves to the next step, the next phrase, then the full piece", () => {
    const phrases = phrasesOf([2], 4);
    expect(phrases).toEqual([
      { from: 0, to: 1 },
      { from: 2, to: 3 },
    ]);
    let progress: PieceProgress = { phrases: {} };
    expect(nextPlace(progress, phrases, "standard")).toEqual({ kind: "phrase", phrase: 0, step: { hand: "left", speed: "standard" } });
    for (const phrase of phrases) {
      for (const step of stepsFor("standard")) progress = withStep(progress, phrase, step, { recent: [true], attempts: 1, passedAt: 1 });
    }
    expect(nextPlace(progress, phrases, "standard")).toEqual({ kind: "full" });
  });

  it("starts slow at 60% of the standard tempo, then plays whatever slow tempo is set", () => {
    expect(stepTempo(defaultSettings(60), "slow")).toBe(36);
    expect(stepTempo(defaultSettings(60), "standard")).toBe(60);
    expect(stepTempo({ ...defaultSettings(60), slowTempo: 44 }, "slow")).toBe(44);
  });

  it("turns a stored slow share into a slow tempo", () => {
    expect(normalizeSettings({ tempo: 100, slowShare: 0.5 } as never).slowTempo).toBe(50);
    expect(normalizeSettings({ tempo: 100, slowTempo: 42 }).slowTempo).toBe(42);
    expect(normalizeSettings({ tempo: 100 }).slowTempo).toBe(60);
  });
});

describe("clipSpan", () => {
  it("keeps the notes starting in the focus, timed from the beat it starts in", () => {
    const span = playSpan(piece(), barRange(0, 1), "right");
    // Beat 2 of bar 1 up to the next note after beat 3: notes at 1, 2 and 3.
    const clipped = clipSpan(span, 1, 4);
    expect(clipped.origin).toBe(1);
    expect(clipped.targets.map((t) => [t.pitch, t.due])).toEqual([
      [74, 0],
      [76, 1],
      [77, 2],
    ]);
    expect(clipped.length).toBe(3);
    expect(clipped.order).toEqual([0]);
    // The bar starts a beat before the focus does: the count-in makes that up.
    expect(clipped.slotStarts).toEqual([-1]);
  });

  it("starts part way into a beat, cuts held notes at the end, and clips the other hand", () => {
    const quick: Piece = { ...piece(), notes: [n("right", 72, 0.5, 0.5), n("right", 74, 1, 3), n("left", 48, 0, 2)] };
    const span = playSpan(quick, [0], "right");
    expect(onsets(span)).toEqual([0, 0.5, 1]);
    const clipped = clipSpan(span, 0.5, 2);
    expect(clipped.origin).toBe(0);
    expect(clipped.targets.map((t) => [t.pitch, t.due, t.length])).toEqual([
      [72, 0.5, 0.5],
      [74, 1, 1],
    ]);
    // The left hand's chord starts before the focus, so it isn't played.
    expect(clipped.others).toEqual([]);
  });

  it("can run across a barline, renumbering the bars it takes", () => {
    const span = playSpan(piece(), barRange(0, 1), "right");
    const clipped = clipSpan(span, 3, 8);
    expect(clipped.order).toEqual([0, 1]);
    expect(clipped.targets.map((t) => [t.pitch, t.due, t.slot])).toEqual([
      [77, 0, 0],
      [79, 1, 1],
    ]);
    const s = new PieceSession(clipped, 60, 4 + 3);
    s.arm(0);
    s.targets.forEach((t) => s.play(t.pitch, 7000 + t.due * 1000));
    expect(s.result().clean).toBe(true);
  });
});
