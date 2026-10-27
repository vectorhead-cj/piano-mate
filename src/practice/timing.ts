import { BEATS } from "../music/rhythms";
import type { Note } from "../music/types";

export type TimingGrade = "early" | "on-time" | "late";

/** Milliseconds per quarter-note beat at the given BPM. */
export function beatMs(tempo: number): number {
  return 60_000 / tempo;
}

/** On-time half-window: generous for screen keyboard, capped at 200ms. */
export function onTimeWindowMs(tempo: number): number {
  return Math.min(200, 0.25 * beatMs(tempo));
}

/**
 * Half-window in which a press still counts for this note (early/late/on-time).
 * Wider than the on-time window so early/late are reachable before a miss.
 * Floor keeps screen-keyboard play fair at fast tempos.
 */
export function acceptWindowMs(tempo: number): number {
  return Math.max(350, 0.5 * beatMs(tempo));
}

/**
 * Expected onset times in ms relative to phrase start (first note at 0).
 * Uses each note's duration to place the *next* onset.
 */
export function expectedOnsets(notes: readonly Note[], tempo: number): number[] {
  const ms = beatMs(tempo);
  const onsets: number[] = [];
  let t = 0;
  for (const note of notes) {
    onsets.push(t);
    t += BEATS[note.duration] * ms;
  }
  return onsets;
}

/** Total phrase length in ms from first onset through the last note's duration. */
export function phraseDurationMs(notes: readonly Note[], tempo: number): number {
  const ms = beatMs(tempo);
  return notes.reduce((sum, note) => sum + BEATS[note.duration] * ms, 0);
}

export function timingGrade(deltaMs: number, tempo: number): TimingGrade {
  const window = onTimeWindowMs(tempo);
  if (Math.abs(deltaMs) <= window) return "on-time";
  return deltaMs < 0 ? "early" : "late";
}
