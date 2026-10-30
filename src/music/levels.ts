import type { Clef, Level, Spelling } from "./types";

function natural(letter: Spelling["letter"], octave: number): Spelling {
  return { letter, alter: 0, octave };
}

function level(
  id: string,
  name: string,
  clef: Clef,
  lowest: Spelling,
  highest: Spelling,
): Level {
  return { id, name, clef, lowest, highest };
}

export const CLEF_LABELS: Record<Clef, string> = {
  treble: "Treble (G)",
  bass: "Bass (F)",
};

export const DEFAULT_CLEF: Clef = "treble";

/**
 * Range presets per clef, from five-finger out through ledger lines. Within a clef
 * each range contains the one before it (see lesserLevel).
 */
export const LEVELS: readonly Level[] = [
  level("five-finger", "Five-finger (C4–G4)", "treble", natural("C", 4), natural("G", 4)),
  level("octave", "One octave (C4–C5)", "treble", natural("C", 4), natural("C", 5)),
  level("treble-staff", "Treble staff (C4–G5)", "treble", natural("C", 4), natural("G", 5)),
  level("ledgers", "With ledgers (A3–C6)", "treble", natural("A", 3), natural("C", 6)),
  level("bass-five-finger", "Five-finger (C3–G3)", "bass", natural("C", 3), natural("G", 3)),
  level("bass-octave", "One octave (C3–C4)", "bass", natural("C", 3), natural("C", 4)),
  level("bass-staff", "Bass staff (F2–C4)", "bass", natural("F", 2), natural("C", 4)),
  level("bass-ledgers", "With ledgers (C2–E4)", "bass", natural("C", 2), natural("E", 4)),
];

export function levelsForClef(clef: Clef): Level[] {
  return LEVELS.filter((l) => l.clef === clef);
}

export const DEFAULT_LEVEL_ID = levelsForClef(DEFAULT_CLEF)[0].id;

export const LEVEL_1 = LEVELS[0];

export function levelById(id: string): Level {
  const found = LEVELS.find((l) => l.id === id);
  if (!found) throw new Error(`Unknown level: ${id}`);
  return found;
}

/** The next-narrower preset in the same clef, if any (ranges are nested). */
export function lesserLevel(level: Level): Level | undefined {
  const sameClef = levelsForClef(level.clef);
  const index = sameClef.findIndex((l) => l.id === level.id);
  return index > 0 ? sameClef[index - 1] : undefined;
}
