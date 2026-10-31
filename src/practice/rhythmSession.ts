import { midiOf } from "../music/pitch";
import { barBeats, BEATS } from "../music/rhythms";
import type { Exercise, Note } from "../music/types";
import { isTieContinuation, nextPressed, tiedOn } from "../music/ties";
import type { PitchMatcher } from "./matcher";
import type { NoteResult } from "./waitSession";
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
  private readonly offsets: (number | undefined)[];

  constructor(
    exercise: Exercise,
    tempo: number,
    private readonly matches: PitchMatcher,
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
    this.offsets = this.notes.map(() => undefined);
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

  /** Wrong keys pressed while `index` was the note to play. */
  wrongAt(index: number): number {
    return this.wrongs[index];
  }

  /** Counts pressed notes only: a tied note is one press. */
  score(): PhraseScore {
    const pressed = this.notes.map((_, i) => i).filter((i) => !isTieContinuation(this.notes, i));
    return {
      notesCorrect: pressed.filter((i) => this.pitchOk[i]).length,
      rhythmOnTime: pressed.filter((i) => this.timingOk[i]).length,
      total: pressed.length,
    };
  }

  results(): NoteResult[] {
    return this.notes.map((_, i) =>
      isTieContinuation(this.notes, i)
        ? { wrong: 0, hit: this.pitchOk[i], tied: true as const }
        : { wrong: this.wrongs[i], hit: this.pitchOk[i], offsetMs: this.offsets[i] },
    );
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
    // Accept from the early edge (may overlap the end of count-in for note 0).
    if (time < expectedAt - window) {
      return { missed, result: { kind: "ignored" } };
    }

    const expectedPitch = midiOf(this.notes[index]);
    if (!this.matches(expectedPitch, pitch)) {
      this.wrongs[index]++;
      return { missed, result: { kind: "wrong", index, expectedPitch } };
    }

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
