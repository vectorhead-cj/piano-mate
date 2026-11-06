import { type KeyInfo } from "./keys";
import { midiOf, pitchClass } from "./pitch";

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11, 12];
const NATURAL_MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10, 12];

/**
 * The key's scale going up one octave from its tonic (natural minor for a minor key), starting
 * on the lowest tonic at or above `lowest`. It can run past the keyboard's top; those notes just sound.
 */
export function ascendingScale(key: KeyInfo, lowest: number): number[] {
  const tonicClass = pitchClass(midiOf({ letter: key.tonic, alter: key.alters[key.tonic], octave: 0 }));
  const tonic = lowest + pitchClass(tonicClass - lowest);
  return (key.mode === "minor" ? NATURAL_MINOR_STEPS : MAJOR_STEPS).map((step) => tonic + step);
}
