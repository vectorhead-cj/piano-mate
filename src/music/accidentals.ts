import { keyAlter, type KeyInfo } from "./keys";
import type { Alter, Note } from "./types";

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
