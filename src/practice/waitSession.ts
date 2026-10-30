import { midiOf } from "../music/pitch";
import type { Exercise, Note } from "../music/types";
import type { PitchMatcher } from "./matcher";

export type PlayResult =
  | { kind: "correct"; index: number; completed: boolean }
  | { kind: "wrong"; index: number; expectedPitch: number }
  | { kind: "ignored" };

export interface WaitScore {
  notesCorrect: number;
  total: number;
}

/** How one note went: wrong keys pressed before the right one, and (rhythm mode) its timing. */
export interface NoteResult {
  wrong: number;
  hit: boolean;
  /** Rhythm mode: press time minus expected onset, in ms. */
  offsetMs?: number;
}

/** Wait mode: nothing advances until the expected note is played. */
export class WaitSession {
  readonly notes: Note[];
  private index = 0;
  /** True if the current note already had a wrong attempt. */
  private missedCurrent = false;
  private firstTryCorrect = 0;
  private readonly wrongs: number[];

  constructor(
    exercise: Exercise,
    private readonly matches: PitchMatcher,
  ) {
    this.notes = exercise.bars.flat();
    this.wrongs = this.notes.map(() => 0);
  }

  /** Index of the note to play next; equals notes.length once complete. */
  get currentIndex(): number {
    return this.index;
  }

  get isComplete(): boolean {
    return this.index >= this.notes.length;
  }

  score(): WaitScore {
    return { notesCorrect: this.firstTryCorrect, total: this.notes.length };
  }

  /** Per-note results; every note counts as hit once the phrase is complete. */
  results(): NoteResult[] {
    return this.notes.map((_, i) => ({ wrong: this.wrongs[i], hit: i < this.index }));
  }

  play(pitch: number): PlayResult {
    if (this.isComplete) return { kind: "ignored" };

    const index = this.index;
    const expectedPitch = midiOf(this.notes[index]);
    if (!this.matches(expectedPitch, pitch)) {
      this.missedCurrent = true;
      this.wrongs[index]++;
      return { kind: "wrong", index, expectedPitch };
    }

    if (!this.missedCurrent) this.firstTryCorrect++;
    this.missedCurrent = false;
    this.index++;
    return { kind: "correct", index, completed: this.isComplete };
  }
}
