import { midiOf } from "../music/pitch";
import { barBeats, BEATS } from "../music/rhythms";
import type { Exercise, Note } from "../music/types";
import { isTieContinuation, nextPressed, pressedIndices, tiedOn } from "../music/ties";
import { countedHolds, HOLD_POLICIES, type HoldFault, type HoldPolicy } from "./holds";
import type { PitchMatcher } from "./matcher";
import type { Mark, NoteResult } from "./waitSession";
import {
  acceptWindowMs,
  beatMs,
  expectedOnsets,
  timingGrade,
  type TimingGrade,
} from "./timing";

export type RhythmPlayResult =
  | { kind: "correct"; index: number; timing: TimingGrade; completed: boolean }
  | { kind: "wrong"; index: number; expectedPitch: number }
  | { kind: "early"; index: number }
  | { kind: "ignored" };

/** A mark per pressed note for its pitch and its timing, side by side. */
export interface PhraseMarks {
  notes: Mark[];
  rhythm: Mark[];
}

/** A key let go while it held a note: which note, and whether it was let go too soon. */
export interface RhythmRelease {
  index: number;
  short: boolean;
}

/** A note whose key is down: when it went down, and when the note's written length ends. */
export interface HeldNote {
  index: number;
  pressedAt: number;
  endsAt: number;
}

export interface RhythmTickResult {
  /** Notes that timed out as missed since the last tick (may be empty). */
  missed: number[];
  /** Index that should be highlighted as current, or notes.length when done. */
  currentIndex: number;
  completed: boolean;
}

/**
 * Live-clock rhythm grading. Absolute times are performance.now()-style ms.
 * Call `arm(startAt)` so phrase start (first note) is at startAt + countInMs.
 *
 * The count-in is one full bar, plus the beats of the next bar before a pickup,
 * so a pickup lands where it sits in its bar and startAt is always a barline.
 */
export class RhythmSession {
  readonly notes: Note[];
  readonly onsets: number[];
  readonly tempo: number;
  /** Quarter beats in a full bar: metronome clicks per bar. */
  readonly beatsPerBar: number;
  readonly countInBeats: number;
  readonly countInMs: number;
  /** Quarter beats from the start of the count-in to the barline after the last note. */
  readonly totalBeats: number;

  private index = 0;
  private phraseStartAt: number | null = null;
  private readonly pitchOk: boolean[];
  private readonly timingOk: boolean[];
  private readonly wrongs: number[];
  private readonly earlies: number[];
  private readonly offsets: (number | undefined)[];
  /** Where each pressed note's written length ends (the next press), ms from phrase start. */
  private readonly ends: number[];
  /** Keys down on a note they played right, by the key played. */
  private readonly held = new Map<number, { index: number; pressedAt: number }>();
  private readonly releases: (number | undefined)[];
  private readonly holds: (HoldFault | undefined)[];

  constructor(
    exercise: Exercise,
    tempo: number,
    private readonly matches: PitchMatcher,
    readonly holdPolicy: HoldPolicy = HOLD_POLICIES.coach,
  ) {
    this.notes = exercise.bars.flat();
    this.tempo = tempo;
    this.onsets = expectedOnsets(this.notes, tempo);
    this.beatsPerBar = barBeats(exercise.time);
    this.countInBeats = exercise.pickup > 0 ? 2 * this.beatsPerBar - exercise.pickup : this.beatsPerBar;
    this.countInMs = this.countInBeats * beatMs(tempo);
    const phraseBeats = this.notes.reduce((sum, note) => sum + BEATS[note.duration], 0);
    // A phrase ending mid-bar still runs to the barline, so the next count-in starts on one.
    this.totalBeats = Math.ceil((this.countInBeats + phraseBeats) / this.beatsPerBar) * this.beatsPerBar;
    this.pitchOk = this.notes.map(() => false);
    this.timingOk = this.notes.map(() => false);
    this.wrongs = this.notes.map(() => 0);
    this.earlies = this.notes.map(() => 0);
    this.offsets = this.notes.map(() => undefined);
    this.releases = this.notes.map(() => undefined);
    this.holds = this.notes.map(() => undefined);
    const phraseMs = phraseBeats * beatMs(tempo);
    this.ends = this.notes.map((_, i) => this.onsets[nextPressed(this.notes, i + 1)] ?? phraseMs);
  }

  /** Wall-clock time of the barline after the last note; undefined until armed. */
  get endAt(): number | undefined {
    return this.phraseStartAt === null ? undefined : this.phraseStartAt - this.countInMs + this.totalBeats * beatMs(this.tempo);
  }

  /** Wall-clock time when the first note is expected. */
  get phraseStart(): number | null {
    return this.phraseStartAt;
  }

  get currentIndex(): number {
    return this.index;
  }

  get isComplete(): boolean {
    return this.index >= this.notes.length;
  }

  isCountingIn(now: number = performance.now()): boolean {
    if (this.phraseStartAt === null) return false;
    return now < this.phraseStartAt;
  }

  /** Schedule phrase start: first note at `now + countInMs`. */
  arm(now: number = performance.now()): void {
    this.phraseStartAt = now + this.countInMs;
  }

  /** Wrong keys, and right keys before its window, pressed while `index` was the note to play. */
  wrongAt(index: number): number {
    return this.wrongs[index];
  }

  /** Pressed notes only: a tied note is one press. A note is settled once the clock moves past it. */
  marks(): PhraseMarks {
    const pressed = pressedIndices(this.notes);
    const counted = countedHolds(this.holds, this.holdPolicy.fails);
    return {
      notes: pressed.map((i) =>
        this.wrongs[i] > this.earlies[i] ? "wrong" : i < this.index ? (this.pitchOk[i] ? "correct" : "wrong") : "pending",
      ),
      rhythm: pressed.map((i) =>
        this.earlies[i] > 0 || counted[i] ? "wrong" : i < this.index ? (this.timingOk[i] ? "correct" : "wrong") : "pending",
      ),
    };
  }

  results(): NoteResult[] {
    return this.notes.map((_, i) =>
      isTieContinuation(this.notes, i)
        ? { wrong: 0, hit: this.pitchOk[i], tied: true as const }
        : {
            wrong: this.wrongs[i],
            hit: this.pitchOk[i],
            offsetMs: this.offsets[i],
            ...(this.earlies[i] > 0 && { early: this.earlies[i] }),
            ...(this.releases[i] !== undefined && { releaseMs: this.releases[i] }),
            ...(this.holds[i] && { hold: this.holds[i] }),
          },
    );
  }

  /** Notes let go too soon or held too long so far. */
  get holdFaults(): number {
    return this.holds.filter((hold) => hold !== undefined).length;
  }

  /** Notes whose keys are down, in the order they were pressed. */
  holding(): HeldNote[] {
    const start = this.phraseStartAt ?? 0;
    return [...this.held.values()]
      .sort((a, b) => a.index - b.index)
      .map(({ index, pressedAt }) => ({ index, pressedAt, endsAt: start + this.ends[index] }));
  }

  /** When the pressed note at `index` is written to end: where the next press is due. */
  noteEndAt(index: number): number {
    return (this.phraseStartAt ?? 0) + this.ends[index];
  }

  /**
   * A key let go. Graded against the beat, not the press: a note pressed late and let go on
   * time was held right. Returns null for a key that wasn't holding a note.
   */
  release(pitch: number, time: number = performance.now()): RhythmRelease | null {
    const key = this.held.get(pitch);
    if (!key || this.phraseStartAt === null) return null;
    this.held.delete(pitch);
    const { index } = key;
    const start = this.phraseStartAt + this.onsets[index];
    const length = this.ends[index] - this.onsets[index];
    this.releases[index] = Math.round(time - (start + length));
    const beats = length / beatMs(this.tempo);
    const share = beats >= 2 ? this.holdPolicy.minHoldLong : this.holdPolicy.minHold;
    const short = beats >= this.holdPolicy.minBeats && time < start + share * length;
    if (short) this.holds[index] = "short";
    return { index, short };
  }

  /**
   * Notes still held past how far into the next note the policy allows; they're marked as
   * held too long and no longer followed. The last note's "next" is its own length again.
   */
  overheld(now: number = performance.now()): number[] {
    if (this.phraseStartAt === null) return [];
    const flagged: number[] = [];
    for (const [pitch, { index }] of this.held) {
      const next = nextPressed(this.notes, index + 1);
      const nextLength = next < this.notes.length ? this.ends[next] - this.onsets[next] : this.ends[index] - this.onsets[index];
      if (now <= this.phraseStartAt + this.ends[index] + this.holdPolicy.maxOverlap * nextLength) continue;
      this.held.delete(pitch);
      this.holds[index] = "long";
      flagged.push(index);
    }
    return flagged;
  }

  /** Moves past the pressed note at `index` and any notes tied on from it. */
  private advanceFrom(index: number): void {
    this.index = nextPressed(this.notes, index + 1);
  }

  /**
   * Close windows that have passed without a correct pitch; notes tied on from a missed
   * note are missed with it. Safe to call every animation frame.
   */
  tick(now: number = performance.now()): RhythmTickResult {
    const missed: number[] = [];
    if (this.phraseStartAt === null) {
      return { missed, currentIndex: this.index, completed: this.isComplete };
    }

    const window = acceptWindowMs(this.tempo);
    while (!this.isComplete) {
      const deadline = this.phraseStartAt + this.onsets[this.index] + window;
      if (now <= deadline) break;
      missed.push(this.index, ...tiedOn(this.notes, this.index));
      this.advanceFrom(this.index);
    }
    return { missed, currentIndex: this.index, completed: this.isComplete };
  }

  play(pitch: number, time: number = performance.now()): {
    missed: number[];
    result: RhythmPlayResult;
  } {
    if (this.isComplete || this.phraseStartAt === null) {
      return { missed: [], result: { kind: "ignored" } };
    }

    const { missed } = this.tick(time);
    if (this.isComplete) {
      return { missed, result: { kind: "ignored" } };
    }

    const index = this.index;
    const window = acceptWindowMs(this.tempo);
    const expectedAt = this.phraseStartAt + this.onsets[index];
    // Accept from the early edge (may overlap the end of count-in for note 0). The count-in
    // is free to noodle in; after it, a press before the window spoils the note to play.
    const tooEarly = time < expectedAt - window;
    if (tooEarly && this.isCountingIn(time)) {
      return { missed, result: { kind: "ignored" } };
    }

    const expectedPitch = midiOf(this.notes[index]);
    if (!this.matches(expectedPitch, pitch)) {
      this.wrongs[index]++;
      return { missed, result: { kind: "wrong", index, expectedPitch } };
    }
    if (tooEarly) {
      this.wrongs[index]++;
      this.earlies[index]++;
      return { missed, result: { kind: "early", index } };
    }

    // A key still down from before (its release never came) is let go as it's played again.
    this.release(pitch, time);
    this.held.set(pitch, { index, pressedAt: time });
    const timing = timingGrade(time - expectedAt, this.tempo);
    this.offsets[index] = Math.round(time - expectedAt);
    for (const i of [index, ...tiedOn(this.notes, index)]) {
      this.pitchOk[i] = true;
      this.timingOk[i] = timing === "on-time";
    }
    this.advanceFrom(index);
    return {
      missed,
      result: { kind: "correct", index, timing, completed: this.isComplete },
    };
  }
}
