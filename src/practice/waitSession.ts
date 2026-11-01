import { midiOf } from "../music/pitch";
import type { Exercise, Note } from "../music/types";
import { isTieContinuation, nextPressed, pressedIndices } from "../music/ties";
import type { PitchMatcher } from "./matcher";

export type PlayResult =
  | { kind: "correct"; index: number; completed: boolean }
  | { kind: "wrong"; index: number; expectedPitch: number }
  | { kind: "ignored" };

/** One pressed note on the score row: not played yet, played clean, or not. */
export type Mark = "pending" | "correct" | "wrong";

/** How one note went: wrong keys pressed before the right one, and (rhythm mode) its timing. */
export interface NoteResult {
  wrong: number;
  hit: boolean;
  /** Rhythm mode: press time minus expected onset, in ms. */
  offsetMs?: number;
  /** Held on from the note before through a tie, so it shares that note's result. */
  tied?: true;
}

/** Wait mode: nothing advances until the expected note is played; tied notes are held, not played. */
export class WaitSession {
  readonly notes: Note[];
  private index = 0;
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

  /** Wrong keys pressed while `index` was the note to play. */
  wrongAt(index: number): number {
    return this.wrongs[index];
  }

  /** A mark per pressed note; a wrong key marks the note at once, even before it's played. */
  marks(): Mark[] {
    return pressedIndices(this.notes).map((i) => (this.wrongs[i] > 0 ? "wrong" : i < this.index ? "correct" : "pending"));
  }

  /** Per-note results; every note counts as hit once the phrase is complete. */
  results(): NoteResult[] {
    return this.notes.map((_, i) =>
      isTieContinuation(this.notes, i) ? { wrong: 0, hit: i < this.index, tied: true as const } : { wrong: this.wrongs[i], hit: i < this.index },
    );
  }

  play(pitch: number): PlayResult {
    if (this.isComplete) return { kind: "ignored" };

    const index = this.index;
    const expectedPitch = midiOf(this.notes[index]);
    if (!this.matches(expectedPitch, pitch)) {
      this.wrongs[index]++;
      return { kind: "wrong", index, expectedPitch };
    }

    this.index = nextPressed(this.notes, index + 1);
    return { kind: "correct", index, completed: this.isComplete };
  }
}
