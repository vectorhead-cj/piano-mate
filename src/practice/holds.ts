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
 * ★★ Play and ★★★ Mix coach half notes and longer held under a quarter of their length;
 * ★★★★ Fluent fails any note held under half its length.
 * Holding too long is checked on every note: smearing into the next is wrong at any length.
 */
export const HOLD_POLICIES: Record<HoldStrictness, HoldPolicy> = {
  coach: { minBeats: 2, minHold: 0.25, minHoldLong: 0.25, maxOverlap: 0.5, fails: false },
  strict: { minBeats: 0, minHold: 0.5, minHoldLong: 0.5, maxOverlap: 0.25, fails: true },
};

/** Let go too soon, or held well into the next note. */
export type HoldFault = "short" | "long";

/** Holds off this many times in a phrase still pass it when holds count; one more fails it. */
export const FORGIVEN_HOLD_FAULTS = 1;

/**
 * Whether each hold fault counts against its phrase: none while coaching, and when holds
 * count, those after the forgiven ones, in note order.
 */
export function countedHolds(holds: readonly (HoldFault | undefined)[], fails: boolean): boolean[] {
  let seen = 0;
  return holds.map((hold) => fails && hold !== undefined && ++seen > FORGIVEN_HOLD_FAULTS);
}

/** Per note, whether it kept the phrase from being clean: wrong, missed, or a counted hold fault. */
export function faultyNotes(notes: readonly NoteResult[], holds?: HoldStrictness): boolean[] {
  const counted = countedHolds(notes.map((n) => n.hold), holds !== undefined && HOLD_POLICIES[holds].fails);
  return notes.map((n, i) => !n.hit || n.wrong > 0 || counted[i]);
}
