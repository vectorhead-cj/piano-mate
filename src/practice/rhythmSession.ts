import { midiOf } from "../music/pitch";
import { BEATS_PER_BAR } from "../music/rhythms";
import type { Exercise, Note } from "../music/types";
import type { PitchMatcher } from "./matcher";
import {
  acceptWindowMs,
  beatMs,
  expectedOnsets,
  phraseDurationMs,
  timingGrade,
  type TimingGrade,
} from "./timing";

export type RhythmPlayResult =
  | { kind: "correct"; index: number; timing: TimingGrade; completed: boolean }
  | { kind: "wrong"; index: number; expectedPitch: number }
  | { kind: "ignored" };

export interface PhraseScore {
  notesCorrect: number;
  rhythmOnTime: number;
  total: number;
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
 */
export class RhythmSession {
  readonly notes: Note[];
  readonly onsets: number[];
  readonly tempo: number;
  readonly countInBeats = BEATS_PER_BAR;
  readonly countInMs: number;
  readonly phraseMs: number;

  private index = 0;
  private phraseStartAt: number | null = null;
  private readonly pitchOk: boolean[];
  private readonly timingOk: boolean[];

  constructor(
    exercise: Exercise,
    tempo: number,
    private readonly matches: PitchMatcher,
  ) {
    this.notes = exercise.bars.flat();
    this.tempo = tempo;
    this.onsets = expectedOnsets(this.notes, tempo);
    this.countInMs = this.countInBeats * beatMs(tempo);
    this.phraseMs = phraseDurationMs(this.notes, tempo);
    this.pitchOk = this.notes.map(() => false);
    this.timingOk = this.notes.map(() => false);
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

  score(): PhraseScore {
    return {
      notesCorrect: this.pitchOk.filter(Boolean).length,
      rhythmOnTime: this.timingOk.filter(Boolean).length,
      total: this.notes.length,
    };
  }

  /**
   * Close windows that have passed without a correct pitch.
   * Safe to call every animation frame.
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
      missed.push(this.index);
      this.index++;
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
    // Accept from the early edge (may overlap the end of count-in for note 0).
    if (time < expectedAt - window) {
      return { missed, result: { kind: "ignored" } };
    }

    const expectedPitch = midiOf(this.notes[index]);
    if (!this.matches(expectedPitch, pitch)) {
      return { missed, result: { kind: "wrong", index, expectedPitch } };
    }

    const timing = timingGrade(time - expectedAt, this.tempo);
    this.pitchOk[index] = true;
    this.timingOk[index] = timing === "on-time";
    this.index++;
    return {
      missed,
      result: { kind: "correct", index, timing, completed: this.isComplete },
    };
  }
}
