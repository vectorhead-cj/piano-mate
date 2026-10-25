import type { Letter, NamingConvention, Spelling } from "./types";

export const LETTERS: readonly Letter[] = ["C", "D", "E", "F", "G", "A", "B"];

const LETTER_SEMITONES: Record<Letter, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const BLACK_KEY_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

export function midiOf({ letter, alter, octave }: Spelling): number {
  return 12 * (octave + 1) + LETTER_SEMITONES[letter] + alter;
}

export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function isBlackKey(midi: number): boolean {
  return BLACK_KEY_PITCH_CLASSES.has(pitchClass(midi));
}

/** Position on the staff, counted in letter steps (C4 = 28, D4 = 29, ...). */
export function staffStep({ letter, octave }: Spelling): number {
  return octave * 7 + LETTERS.indexOf(letter);
}

export function naturalFromStaffStep(step: number): Spelling {
  return {
    letter: LETTERS[((step % 7) + 7) % 7],
    alter: 0,
    octave: Math.floor(step / 7),
  };
}

const ALTER_SYMBOLS = { [-1]: "♭", 0: "", 1: "♯" } as const;

/**
 * Swedish uses H for B natural and B for B flat; everything else matches English.
 */
export function noteName(spelling: Spelling, convention: NamingConvention): string {
  const { letter, alter } = spelling;
  if (convention === "swedish" && letter === "B") {
    if (alter === 0) return "H";
    if (alter === -1) return "B";
    return "H♯";
  }
  return letter + ALTER_SYMBOLS[alter];
}

/** Label for a white piano key. */
export function whiteKeyName(midi: number, convention: NamingConvention): string {
  const letter = LETTERS.find((l) => LETTER_SEMITONES[l] === pitchClass(midi));
  if (!letter) throw new Error(`MIDI ${midi} is not a white key`);
  return noteName({ letter, alter: 0, octave: 0 }, convention);
}
