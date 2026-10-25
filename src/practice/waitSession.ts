import { midiOf } from "../music/pitch";
import type { Exercise, Note } from "../music/types";
import type { PitchMatcher } from "./matcher";

export type PlayResult =
  | { kind: "correct"; index: number; completed: boolean }
  | { kind: "wrong"; index: number; expectedPitch: number }
  | { kind: "ignored" };

/** Wait mode: nothing advances until the expected note is played. */
export class WaitSession {
  readonly notes: Note[];
  private index = 0;

  constructor(
    exercise: Exercise,
    private readonly matches: PitchMatcher,
  ) {
    this.notes = exercise.bars.flat();
  }

  /** Index of the note to play next; equals notes.length once complete. */
  get currentIndex(): number {
    return this.index;
  }

  get isComplete(): boolean {
    return this.index >= this.notes.length;
  }

  play(pitch: number): PlayResult {
    if (this.isComplete) return { kind: "ignored" };

    const index = this.index;
    const expectedPitch = midiOf(this.notes[index]);
    if (!this.matches(expectedPitch, pitch)) {
      return { kind: "wrong", index, expectedPitch };
    }

    this.index++;
    return { kind: "correct", index, completed: this.isComplete };
  }
}
