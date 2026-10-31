import type { AccidentalFrequency, Alter, Letter } from "./types";

/** Letter order on the staff (same as pitch.LETTERS). */
const LETTERS: readonly Letter[] = ["C", "D", "E", "F", "G", "A", "B"];

/** Circle-of-fifths order for key-signature accidentals. */
const SHARP_ORDER: readonly Letter[] = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER: readonly Letter[] = ["B", "E", "A", "D", "G", "C", "F"];

export type KeyMode = "major" | "minor";

export interface KeyInfo {
  /** Key id: "G", "Bb", "F#" for majors; "Em", "Gm", "F#m" for minors. */
  id: string;
  /** UI label pairing major with its relative minor. */
  label: string;
  mode: KeyMode;
  /** Tonic letter of this key's own mode (alter comes from `alters`). */
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
  return { id, label, mode: "major", tonic, signature, alters: altersFor(signature) };
}

/** The relative minor of a major key: same signature, tonic a sixth up ("C" → "Am"). */
function relativeMinor(major: KeyInfo): KeyInfo {
  const tonic = relativeMinorTonic(major.tonic);
  const id = `${tonic}${{ [-1]: "b", 0: "", 1: "#" }[major.alters[tonic]]}m`;
  return { ...major, id, label: major.label, mode: "minor", tonic };
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

/** Relative minors of KEYS, in the same order ("Am", "Em", …, "Dm", "Gm", …). */
export const MINOR_KEYS: readonly KeyInfo[] = KEYS.map(relativeMinor);

export const DEFAULT_KEY_ID = "C";

export function keyById(id: string): KeyInfo {
  const found = KEYS.find((k) => k.id === id) ?? MINOR_KEYS.find((k) => k.id === id);
  if (!found) throw new Error(`Unknown key: ${id}`);
  return found;
}

/** The letters a key signature sharpens or flattens, in the order they're written. */
export function signatureLetters(key: KeyInfo): Letter[] {
  return key.signature > 0 ? SHARP_ORDER.slice(0, key.signature) : FLAT_ORDER.slice(0, -key.signature);
}

/** The major key sharing a minor key's signature (itself for a major key). */
export function relativeMajor(key: KeyInfo): KeyInfo {
  return KEYS.find((k) => k.signature === key.signature)!;
}

export function keyAlter(key: KeyInfo, letter: Letter): Alter {
  return key.alters[letter];
}

/** Letters of the triad on a tonic (root, third, fifth); the same letters in major and minor. */
export function majorTriadLetters(tonic: Letter): readonly Letter[] {
  const i = LETTERS.indexOf(tonic);
  return [LETTERS[i], LETTERS[(i + 2) % 7], LETTERS[(i + 4) % 7]];
}

/** Relative minor tonic letter for a major key. */
export function relativeMinorTonic(tonic: Letter): Letter {
  const i = LETTERS.indexOf(tonic);
  return LETTERS[(i + 5) % 7];
}

/** Relative major tonic letter for a minor key. */
export function relativeMajorTonic(tonic: Letter): Letter {
  const i = LETTERS.indexOf(tonic);
  return LETTERS[(i + 2) % 7];
}

/** Letter of the 7th degree, raised to a leading tone in minor (G in A minor). */
export function seventhDegreeLetter(tonic: Letter): Letter {
  const i = LETTERS.indexOf(tonic);
  return LETTERS[(i + 6) % 7];
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
