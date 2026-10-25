import { pitchClass } from "../music/pitch";

export type PitchMatcher = (expected: number, played: number) => boolean;

/** Screen and MIDI: the exact key. F♯4 and G♭4 are the same key, so this is enharmonic. */
export const exactPitch: PitchMatcher = (expected, played) => expected === played;

/** Whistling: right note name in any octave. Cents tolerance is the mic input's job. */
export const samePitchClass: PitchMatcher = (expected, played) =>
  pitchClass(expected) === pitchClass(played);
