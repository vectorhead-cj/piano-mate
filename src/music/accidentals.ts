import { keyAlter, type KeyInfo } from "./keys";
import { LETTERS, midiOf, pitchClass } from "./pitch";
import type { Alter, Letter, Note, Spelling } from "./types";

export type AccidentalSymbol = "#" | "b" | "n";

const SYMBOL_FOR_ALTER: Record<Alter, AccidentalSymbol> = { [-1]: "b", 0: "n", 1: "#" };

/**
 * Which accidental to print on each note of one bar, given the key signature.
 * An accidental lasts until the end of the bar for that exact staff position,
 * so a later note on the same line/space only gets a sign if it changes again.
 * Key-signature alters are the default; a natural is printed when they are cancelled.
 */
export function accidentalsForBar(bar: Note[], key: KeyInfo): (AccidentalSymbol | null)[] {
  const activeAlter = new Map<string, Alter>();
  return bar.map((note) => {
    const position = `${note.letter}${note.octave}`;
    const current = activeAlter.get(position) ?? keyAlter(key, note.letter);
    if (note.alter === current) return null;
    activeAlter.set(position, note.alter);
    return SYMBOL_FOR_ALTER[note.alter];
  });
}

/**
 * How a played key is written in a key: the key signature's own spelling when it has one
 * (no sign), else the white key with a natural, else a black key spelled with the
 * signature's side (sharps in C and sharp keys, flats in flat keys).
 */
export function spellInKey(midi: number, key: KeyInfo): { spelling: Spelling; accidental: AccidentalSymbol | null } {
  const at = (letter: Letter, alter: Alter): Spelling => ({
    letter,
    alter,
    octave: Math.floor((midi - midiOf({ letter, alter, octave: -1 })) / 12) - 1,
  });
  const matches = (letter: Letter, alter: Alter) => pitchClass(midiOf({ letter, alter, octave: 0 })) === pitchClass(midi);
  const inKey = LETTERS.find((letter) => matches(letter, keyAlter(key, letter)));
  if (inKey) return { spelling: at(inKey, keyAlter(key, inKey)), accidental: null };
  const natural = LETTERS.find((letter) => matches(letter, 0));
  if (natural) return { spelling: at(natural, 0), accidental: "n" };
  const alter: Alter = key.signature < 0 ? -1 : 1;
  const letter = LETTERS.find((l) => matches(l, alter))!;
  return { spelling: at(letter, alter), accidental: SYMBOL_FOR_ALTER[alter] };
}
