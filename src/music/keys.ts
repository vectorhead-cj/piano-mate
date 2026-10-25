import type { AccidentalFrequency, Alter, Letter } from "./types";

/** Letter order on the staff (same as pitch.LETTERS). */
const LETTERS: readonly Letter[] = ["C", "D", "E", "F", "G", "A", "B"];

/** Circle-of-fifths order for key-signature accidentals. */
const SHARP_ORDER: readonly Letter[] = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER: readonly Letter[] = ["B", "E", "A", "D", "G", "C", "F"];

export interface KeyInfo {
  /** VexFlow major-key spec, e.g. "G", "Bb", "F#". */
  id: string;
  /** UI label pairing major with its relative minor. */
  label: string;
  /** Major tonic letter (alter comes from `alters`). */
  tonic: Letter;
  /** How many sharps (>0) or flats (<0) the signature has. */
  signature: number;
  /** Key-signature alter for each letter. */
  alters: Record<Letter, Alter>;
}

function altersFor(signature: number): Record<Letter, Alter> {
  const alters = Object.fromEntries(LETTERS.map((letter) => [letter, 0])) as Record<Letter, Alter>;
  if (signature > 0) {
    for (let i = 0; i < signature; i++) alters[SHARP_ORDER[i]] = 1;
  } else if (signature < 0) {
    for (let i = 0; i < -signature; i++) alters[FLAT_ORDER[i]] = -1;
  }
  return alters;
}

function key(id: string, label: string, tonic: Letter, signature: number): KeyInfo {
  return { id, label, tonic, signature, alters: altersFor(signature) };
}

/** Standard western major keys (with relative-minor labels), sharp then flat side. */
export const KEYS: readonly KeyInfo[] = [
  key("C", "C / Am", "C", 0),
  key("G", "G / Em", "G", 1),
  key("D", "D / Bm", "D", 2),
  key("A", "A / F♯m", "A", 3),
  key("E", "E / C♯m", "E", 4),
  key("B", "B / G♯m", "B", 5),
  key("F#", "F♯ / D♯m", "F", 6),
  key("C#", "C♯ / A♯m", "C", 7),
  key("F", "F / Dm", "F", -1),
  key("Bb", "B♭ / Gm", "B", -2),
  key("Eb", "E♭ / Cm", "E", -3),
  key("Ab", "A♭ / Fm", "A", -4),
  key("Db", "D♭ / B♭m", "D", -5),
  key("Gb", "G♭ / E♭m", "G", -6),
  key("Cb", "C♭ / A♭m", "C", -7),
];

export const DEFAULT_KEY_ID = "C";

export function keyById(id: string): KeyInfo {
  const found = KEYS.find((k) => k.id === id);
  if (!found) throw new Error(`Unknown key: ${id}`);
  return found;
}

export function keyAlter(key: KeyInfo, letter: Letter): Alter {
  return key.alters[letter];
}

/** Letters of the major tonic triad (root, third, fifth). */
export function majorTriadLetters(tonic: Letter): readonly Letter[] {
  const i = LETTERS.indexOf(tonic);
  return [LETTERS[i], LETTERS[(i + 2) % 7], LETTERS[(i + 4) % 7]];
}

/** Relative minor tonic letter for a major key. */
export function relativeMinorTonic(tonic: Letter): Letter {
  const i = LETTERS.indexOf(tonic);
  return LETTERS[(i + 5) % 7];
}

export const ACCIDENTAL_FREQUENCY_CHANCE: Record<AccidentalFrequency, number> = {
  none: 0,
  rare: 0.08,
  medium: 0.22,
  common: 0.45,
};

export const ACCIDENTAL_FREQUENCY_LABELS: Record<AccidentalFrequency, string> = {
  none: "none",
  rare: "rare",
  medium: "medium",
  common: "common",
};
