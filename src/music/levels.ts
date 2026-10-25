import type { Level } from "./types";

function level(
  id: string,
  name: string,
  lowest: Level["lowest"],
  highest: Level["highest"],
): Level {
  return {
    id,
    name,
    clef: "treble",
    lowest,
    highest,
    durations: ["w", "h", "q"],
  };
}

/** Treble-clef range presets, from five-finger up through ledger lines. */
export const LEVELS: readonly Level[] = [
  level("five-finger", "Five-finger (C4–G4)", { letter: "C", alter: 0, octave: 4 }, {
    letter: "G",
    alter: 0,
    octave: 4,
  }),
  level("octave", "One octave (C4–C5)", { letter: "C", alter: 0, octave: 4 }, {
    letter: "C",
    alter: 0,
    octave: 5,
  }),
  level("treble-staff", "Treble staff (C4–G5)", { letter: "C", alter: 0, octave: 4 }, {
    letter: "G",
    alter: 0,
    octave: 5,
  }),
  level("ledgers", "With ledgers (A3–C6)", { letter: "A", alter: 0, octave: 3 }, {
    letter: "C",
    alter: 0,
    octave: 6,
  }),
];

export const DEFAULT_LEVEL_ID = LEVELS[0].id;

export const LEVEL_1 = LEVELS[0];

export function levelById(id: string): Level {
  const found = LEVELS.find((l) => l.id === id);
  if (!found) throw new Error(`Unknown level: ${id}`);
  return found;
}
