import type { Level } from "./types";

export const LEVEL_1: Level = {
  id: 1,
  name: "Treble clef, C4–G4",
  clef: "treble",
  lowest: { letter: "C", alter: 0, octave: 4 },
  highest: { letter: "G", alter: 0, octave: 4 },
  durations: ["w", "h", "q"],
};
