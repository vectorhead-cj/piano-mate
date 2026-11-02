import type { NoteResult } from "./waitSession";

/**
 * How strictly rhythm mode grades how long each note is held. Coaching points out holds
 * that are off and never fails for them; strict fails the attempt.
 */
export type HoldStrictness = "coach" | "strict";

export interface HoldPolicy {
  /** Shortest written length, in quarter beats, checked for being let go too soon. */
  minBeats: number;
  /** Share of its written length a note under two beats must be held. */
  minHold: number;
  /** Share of its written length a note of two beats or more must be held. */
  minHoldLong: number;
  /** How far into the next note a key may stay down, as a share of that note's length. */
  maxOverlap: number;
  /** Whether a hold outside these limits fails the attempt. */
  fails: boolean;
}

/**
 * ★★ Play and ★★★ Mix coach half notes and longer; ★★★★ Fluent grades every note, tighter.
 * Holding too long is checked on every note: smearing into the next is wrong at any length.
 */
export const HOLD_POLICIES: Record<HoldStrictness, HoldPolicy> = {
  coach: { minBeats: 2, minHold: 0.5, minHoldLong: 0.5, maxOverlap: 0.5, fails: false },
  strict: { minBeats: 0, minHold: 0.75, minHoldLong: 0.85, maxOverlap: 0.25, fails: true },
};

/** Let go too soon, or held well into the next note. */
export type HoldFault = "short" | "long";

/** Right key, in its window, no wrong keys first, and (when holds count) held as long as written. */
export function cleanNote(note: NoteResult, holds?: HoldStrictness): boolean {
  return note.hit && note.wrong === 0 && !(note.hold && holds !== undefined && HOLD_POLICIES[holds].fails);
}
