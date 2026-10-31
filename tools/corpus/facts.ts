import { KEYS, MINOR_KEYS, type KeyInfo } from "../../src/music/keys";
import { staffStep } from "../../src/music/pitch";
import type { Clef, Letter } from "../../src/music/types";

/**
 * Raw facts about each extracted phrase. Nothing here decides curriculum stages: the
 * report filters these facts, so stage definitions can change without re-extracting.
 */

/** One note; rests are where extract.py cuts, so they never appear inside a phrase. */
export interface RawNote {
  /** Bar index within the line, counted as the bars appear. */
  measure: number;
  /** Quarter lengths from the start of a full bar. */
  beat: number;
  /** Length in quarter notes. */
  ql: number;
  dots: number;
  /** "3:2" for triplets. */
  tuplet: string | null;
  tie: "start" | "stop" | "continue" | null;
  grace: boolean;
  /** Several notes at once; step, alter and octave are the top one's. */
  chord: boolean;
  step: Letter;
  alter: number;
  octave: number;
}

export interface RawPhrase {
  id: string;
  collection: string;
  work: string;
  title: string | null;
  /** Part name, or "part 2" when the score has none. */
  voice: string;
  /** Picked from the line's register, not its written clef. */
  clef: Clef;
  index: number;
  keyFifths: number;
  analyzedKey: { step: Letter; alter: number; mode: "major" | "minor" };
  /** Time signature at the first note, e.g. "4/4". */
  time: string;
  /** Every time signature the phrase passes through. */
  times: string[];
  /** Note values halved from 4/2 or 3/2, as modern editions of Renaissance music do. */
  halved: boolean;
  /** Where the phrase was cut: after a fermata, at a rest, at the end of the line, or a window of a longer stretch. */
  cut: "fermata" | "rest" | "end" | "window";
  notes: RawNote[];
}

/** [bar, beat, ql, dots, tuplet, tie, flags, step, alter, octave], as extract.py writes notes. */
type NoteRow = [number, number, number, number, string | 0, number, number, Letter, number, number];

/** One collection file as extract.py writes it. */
export interface CollectionFile {
  collection: string;
  label: string;
  files: number;
  phrases: (Omit<RawPhrase, "notes"> & { notes: NoteRow[] })[];
}

const TIES = [null, "start", "stop", "continue"] as const;
const GRACE = 2;
const CHORD = 4;

export function decodeNote([measure, beat, ql, dots, tuplet, tie, flags, step, alter, octave]: NoteRow): RawNote {
  return {
    measure,
    beat,
    ql,
    dots,
    tuplet: tuplet || null,
    tie: TIES[tie],
    grace: (flags & GRACE) !== 0,
    chord: (flags & CHORD) !== 0,
    step,
    alter,
    octave,
  };
}

export function decodePhrases(file: CollectionFile): RawPhrase[] {
  // Small collections share one file, and are toggled together under its name.
  return file.phrases.map((phrase) => ({ ...phrase, collection: file.collection, notes: phrase.notes.map(decodeNote) }));
}

const NOTE_TYPES: Record<number, string> = { 8: "breve", 4: "whole", 2: "half", 1: "quarter", 0.5: "eighth", 0.25: "16th", 0.125: "32nd" };

/** MusicXML note type ("quarter") from a note's length, dots and tuplet. */
export function noteType(n: RawNote): string {
  const [actual, normal] = n.tuplet ? n.tuplet.split(":").map(Number) : [1, 1];
  const dotFactor = 2 - 0.5 ** n.dots;
  const base = Math.round(((n.ql * actual) / normal / dotFactor) * 96) / 96;
  return NOTE_TYPES[base] ?? "quarter";
}

/**
 * Ranges in staff steps from the tonic (0 = tonic, 4 = the fifth above, -3 = the fifth
 * below). A phrase fits when some octave shift puts every note inside.
 */
export const RANGE_WINDOWS = [
  { id: "five", label: "Five (1–5)", low: 0, high: 4 },
  { id: "sixth", label: "Sixth (1–6)", low: 0, high: 5 },
  { id: "authentic", label: "Authentic octave (1–8)", low: 0, high: 7 },
  { id: "plagal", label: "Plagal octave (5,–5)", low: -3, high: 4 },
  { id: "dominant-octave", label: "5, to 8", low: -3, high: 7 },
  { id: "tonic-twelfth", label: "Twelfth (1–5')", low: 0, high: 11 },
  { id: "dominant-twelfth", label: "5, to 5'", low: -3, high: 11 },
  { id: "two-octaves", label: "Two octaves (1–8')", low: 0, high: 14 },
] as const;

export type RangeWindowId = (typeof RANGE_WINDOWS)[number]["id"];

/** At most this share of moves may stay on the same pitch. */
export const REPEAT_LIMIT = 0.4;

export type MelodicFailure = "distinct" | "repeats";

/**
 * Why a phrase reads as accompaniment rather than melody, or null when it is melodic. It needs
 * minDistinct different notes, or every note of its narrowest range when that holds fewer
 * (a five-note phrase can't have six), and repeats can't dominate.
 */
export function melodicFailure(facts: Pick<PhraseFacts, "distinctNotes" | "repeatShare" | "narrowest">, minDistinct: number): MelodicFailure | null {
  const window = RANGE_WINDOWS.find((w) => w.id === facts.narrowest);
  const allowed = window ? window.high - window.low + 1 : Infinity;
  if (facts.distinctNotes < Math.min(minDistinct, allowed)) return "distinct";
  if (facts.repeatShare > REPEAT_LIMIT) return "repeats";
  return null;
}

/** Note lengths in quarter notes the app can play: whole, dotted half, half, dotted quarter, quarter, eighth. */
const PLAYABLE_LENGTHS = [4, 3, 2, 1.5, 1, 0.5];

/** Lengths that need no eighth-note counting; a dotted quarter implies an eighth to follow. */
const BASIC_LENGTHS = [4, 3, 2, 1];

/** 2/2 bars hold the same notes as 4/4 and are written the same way. */
const PLAYABLE_TIMES = ["4/4", "3/4", "2/2"];

/** Reasons a phrase can't be played by the app as it stands. */
export type Blocker =
  | "note-value"
  | "tuplet"
  | "tie"
  | "chord"
  | "grace"
  | "meter"
  | "minor"
  | "modal-signature"
  | "double-accidental";

export const BLOCKER_LABELS: Record<Blocker, string> = {
  "note-value": "Sixteenths and other note values",
  tuplet: "Tuplets",
  tie: "Ties",
  chord: "Chords",
  grace: "Grace notes",
  meter: "Time signatures other than 4/4, 2/2 and 3/4",
  minor: "Minor key",
  "modal-signature": "Key signature doesn't name the key",
  "double-accidental": "Double sharps or flats",
};

export const BLOCKER_EXPLANATIONS: Record<Blocker, string> = {
  "note-value":
    "A note the app has no value for: sixteenths, dotted eighths (which come with a sixteenth), double dots or dotted wholes.",
  tuplet: "Triplets or other tuplets.",
  tie: "A note tied over to the next one, usually across a barline.",
  chord: "Two or more notes at once, from a piano or a divided part.",
  grace: "An ornamental grace note.",
  meter: "The phrase is in 2/4, 6/8 or another time, or changes time partway. 2/2 counts as 4/4, since it is written the same way.",
  minor: "The phrase is in a minor key.",
  "modal-signature":
    "The music is in a different key from the one the signature names, usually older modal notation (G minor written with one flat).",
  "double-accidental": "A double sharp or double flat.",
};

export type RhythmBucket = "basic" | "eighths" | "busy";

export const RHYTHM_LABELS: Record<RhythmBucket, string> = {
  basic: "Basic: quarters, halves, dotted halves and wholes",
  eighths: "Eighths: some eighths or dotted quarters",
  busy: "Busy: half the notes or more are eighths",
};

export interface PhraseFacts {
  phrase: RawPhrase;
  key: KeyInfo;
  mode: "major" | "minor";
  /** Notes to read: tied continuations count once, grace notes not at all. */
  noteCount: number;
  /** Bars the phrase spans, not counting a pickup bar. */
  bars: number;
  /** Starts before beat 1. */
  pickup: boolean;
  /** Its last note ends before the barline. */
  endsMidBar: boolean;
  /** Lowest and highest note in staff steps from the tonic, shifted so the lowest is within a fourth of it. */
  low: number;
  high: number;
  windows: RangeWindowId[];
  /** Narrowest window that fits, in RANGE_WINDOWS order, or null when none does. */
  narrowest: RangeWindowId | null;
  /** Notes whose alter differs from the key signature. */
  chromatic: number;
  /** Different pitches the phrase uses (C4 and C5 are two, C4 and C♯4 are two). */
  distinctNotes: number;
  /** Share of note-to-note moves that stay on the same pitch. */
  repeatShare: number;
  /** Share of notes that are eighths. */
  eighthShare: number;
  /** The lowest rhythm level that covers every note value and the time signature. */
  rhythm: RhythmBucket;
  blockers: Blocker[];
  /** Same for every transposition of the same melody in the same voice. */
  shape: string;
}

function signatureKey(fifths: number, mode: "major" | "minor"): KeyInfo {
  const keys = mode === "major" ? KEYS : MINOR_KEYS;
  const found = keys.find((k) => k.signature === fifths);
  if (!found) throw new Error(`No key with ${fifths} fifths`);
  return found;
}

function barLength(time: string): number {
  const [beats, unit] = time.split("/").map(Number);
  return (beats * 4) / unit;
}

export function fitsWindow(low: number, high: number, window: { low: number; high: number }): boolean {
  // Octave shifts k with window.low <= low - 7k and high - 7k <= window.high.
  return Math.ceil((high - window.high) / 7) <= Math.floor((low - window.low) / 7);
}

export function rhythmBucket(notes: readonly RawNote[]): { bucket: RhythmBucket; eighthShare: number } {
  const eighthShare = notes.filter((n) => n.ql === 0.5).length / notes.length;
  if (notes.every((n) => BASIC_LENGTHS.includes(n.ql))) return { bucket: "basic", eighthShare };
  return { bucket: eighthShare >= 0.5 ? "busy" : "eighths", eighthShare };
}

/** "5," / "1" / "3'" for a staff-step distance from the tonic. */
export function degreeLabel(step: number): string {
  const octave = Math.floor(step / 7);
  const degree = step - octave * 7 + 1;
  return `${degree}${octave < 0 ? ",".repeat(-octave) : "'".repeat(octave)}`;
}

/** Which notes of a phrase cause a blocker; empty when the cause is the whole phrase. */
export function blockingNotes(phrase: RawPhrase, blocker: Blocker): RawNote[] {
  const test: Partial<Record<Blocker, (n: RawNote) => boolean>> = {
    "note-value": (n) => !n.grace && !n.tuplet && (n.dots > 1 || !PLAYABLE_LENGTHS.includes(n.ql)),
    tuplet: (n) => n.tuplet !== null,
    tie: (n) => n.tie !== null,
    chord: (n) => n.chord,
    grace: (n) => n.grace,
    "double-accidental": (n) => Math.abs(n.alter) > 1,
  };
  const matches = test[blocker];
  return matches ? phrase.notes.filter(matches) : [];
}

const NOTE_BLOCKERS: readonly Blocker[] = ["note-value", "tuplet", "tie", "chord", "grace", "double-accidental"];

export function phraseFacts(phrase: RawPhrase): PhraseFacts {
  const mode = phrase.analyzedKey.mode;
  const key = signatureKey(phrase.keyFifths, mode);
  const pitched = phrase.notes.filter((n) => !n.grace);
  // A tied continuation is the same sounding note, not a new one to read.
  const played = pitched.filter((n) => n.tie !== "stop" && n.tie !== "continue");

  const tonicStep = staffStep({ letter: phrase.analyzedKey.step, alter: 0, octave: 0 });
  const stepOf = (n: RawNote) => staffStep({ letter: n.step, alter: 0, octave: n.octave }) - tonicStep;
  const steps = pitched.map(stepOf);
  const rawLow = Math.min(...steps);
  const shift = Math.floor((rawLow + 3) / 7) * 7;
  const low = rawLow - shift;
  const high = Math.max(...steps) - shift;
  const windows = RANGE_WINDOWS.filter((w) => fitsWindow(low, high, w)).map((w) => w.id);

  const chromatic = played.filter((n) => n.alter !== key.alters[n.step]).length;
  const { bucket: rhythm, eighthShare } = rhythmBucket(played);
  const pitchOf = (n: RawNote) => `${n.step}${n.alter}${n.octave}`;
  const repeats = played.slice(1).filter((n, i) => pitchOf(n) === pitchOf(played[i])).length;

  const first = phrase.notes[0];
  const last = phrase.notes[phrase.notes.length - 1];
  const pickup = first.beat !== 0;
  const blockers = new Set<Blocker>(NOTE_BLOCKERS.filter((b) => blockingNotes(phrase, b).length > 0));
  if (phrase.times.length > 1 || !PLAYABLE_TIMES.includes(phrase.time)) blockers.add("meter");
  if (mode === "minor") blockers.add("minor");
  const tonic = phrase.analyzedKey;
  if (key.tonic !== tonic.step || key.alters[key.tonic] !== tonic.alter) blockers.add("modal-signature");

  const shape = [phrase.clef, first.beat, ...phrase.notes.map((n) => `${stepOf(n)}:${n.alter - key.alters[n.step]}:${n.ql}`)].join(" ");

  return {
    phrase,
    key,
    mode,
    noteCount: played.length,
    bars: last.measure - first.measure + 1 - (pickup ? 1 : 0),
    pickup,
    endsMidBar: Math.abs(last.beat + last.ql - barLength(phrase.time)) > 1e-6,
    low,
    high,
    windows,
    narrowest: windows[0] ?? null,
    chromatic,
    distinctNotes: new Set(played.map(pitchOf)).size,
    repeatShare: played.length > 1 ? repeats / (played.length - 1) : 0,
    eighthShare,
    rhythm,
    blockers: [...blockers],
    shape,
  };
}

/** Facts for every phrase, with later repeats of an earlier melody marked. */
export function corpusFacts(phrases: readonly RawPhrase[]): { facts: PhraseFacts; duplicateOf: string | null }[] {
  const firstByShape = new Map<string, string>();
  return phrases.map((phrase) => {
    const facts = phraseFacts(phrase);
    const earlier = firstByShape.get(facts.shape) ?? null;
    if (!earlier) firstByShape.set(facts.shape, phrase.id);
    return { facts, duplicateOf: earlier };
  });
}
