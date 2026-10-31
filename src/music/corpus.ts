import { keyAlter, keyById, type KeyMode } from "./keys";
import { notationsOf, type Notation } from "./notation";
import { naturalFromStaffStep } from "./pitch";
import type { Alter, Clef, Duration, Exercise, Note, RhythmFlavor, TimeSignature } from "./types";

/**
 * Phrases from real music (tools/corpus exports them to public/phrases.json). Each is stored
 * relative to its key, so it can be written out in any key and octave.
 */

/** One note: staff steps from the tonic, and a sharp (+1) or flat (-1) relative to the key signature. */
export interface CorpusNote {
  step: number;
  offset: -1 | 0 | 1;
  duration: Duration;
  /** Tied to the next note. */
  tie: boolean;
}

export interface CorpusPhrase {
  id: string;
  /** "Essen folk songs: Ich fahr dahin", with the part when the score has several. */
  source: string;
  clef: Clef;
  time: TimeSignature;
  pickup: number;
  rhythm: RhythmFlavor;
  /** Steps count from this mode's tonic, so a minor phrase belongs in a minor key. */
  mode: KeyMode;
  /** Notes outside the key; in minor, the raised 6th and 7th don't count, as they belong to it. */
  chromatic: number;
  /** Narrowest range window it fits, e.g. "five", "plagal" (see tools/corpus/facts.ts). */
  window: string;
  /** Bars, not counting a pickup bar. */
  bars: number;
  /** Lowest and highest step; steps are placed inside the narrowest window. */
  low: number;
  high: number;
  notes: CorpusNote[][];
  /** Rhythm and meter notation it uses, which decides the stages it can appear in. */
  notations: ReadonlySet<Notation>;
}

type Row = [string, number, string, 0 | 1, number, number, number, number, number, number, string, 0 | 1];

interface BankFile {
  v: 1;
  windows: string[];
  times: TimeSignature[];
  rhythms: RhythmFlavor[];
  sources: string[];
  phrases: Row[];
}

const NOTE = /^(-?\d+)([#b]?)(w|h\.|h|q\.|q|8)(~?)$/;

/** Bars of notes written as in phrases.json: "0q 1#8 2h~|2q", steps from the tonic. */
export function parseNotes(text: string): CorpusNote[][] {
  return text.split("|").map((bar) =>
    bar.split(" ").map((token): CorpusNote => {
      const match = NOTE.exec(token);
      if (!match) throw new Error(`Bad note "${token}"`);
      return {
        step: Number(match[1]),
        offset: match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0,
        duration: match[3] as Duration,
        tie: match[4] === "~",
      };
    }),
  );
}

export function parseBank(file: BankFile): CorpusPhrase[] {
  return file.phrases.map(([id, source, voice, clef, time, pickup, rhythm, chromatic, window, bars, text, mode]) => {
    let notes: CorpusNote[][];
    try {
      notes = parseNotes(text);
    } catch (error) {
      throw new Error(`${(error as Error).message} in ${id}`);
    }
    const steps = notes.flat().map((n) => n.step);
    const name = file.sources[source];
    const timeSignature = file.times[time];
    return {
      id,
      source: /^part \d+$/.test(voice) ? name : `${name} (${voice})`,
      clef: clef === 0 ? "treble" : "bass",
      time: timeSignature,
      pickup,
      rhythm: file.rhythms[rhythm],
      mode: mode === 0 ? "major" : "minor",
      chromatic,
      window: file.windows[window],
      bars,
      low: Math.min(...steps),
      high: Math.max(...steps),
      notes,
      notations: notationsOf(timeSignature, pickup, notes),
    };
  });
}

let loading: Promise<CorpusPhrase[] | null> | null = null;

/** The phrase bank, fetched once from beside the page; null if it can't be loaded. */
export function loadCorpus(): Promise<CorpusPhrase[] | null> {
  loading ??= fetch(`${import.meta.env.BASE_URL}phrases.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<BankFile>;
    })
    .then(parseBank)
    .catch((error: unknown) => {
      console.warn("Couldn't load the phrase corpus; using generated phrases.", error);
      return null;
    });
  return loading;
}

/**
 * The phrase written in a key of its own mode with its tonic at `tonicStep` (a staff step, see
 * pitch.ts), or null when a note would need a double sharp or flat there.
 */
export function phraseInKey(phrase: CorpusPhrase, keyId: string, tonicStep: number): Exercise | null {
  const bars = notesInKey(phrase.notes, keyId, tonicStep);
  if (!bars) return null;
  return { clef: phrase.clef, key: keyById(keyId).id, time: phrase.time, pickup: phrase.pickup, bars, source: { id: phrase.id, label: phrase.source } };
}

/** Steps from the tonic spelled in a key with its tonic at `tonicStep`; null if one needs a double sharp or flat. */
export function notesInKey(steps: readonly CorpusNote[][], keyId: string, tonicStep: number): Note[][] | null {
  const key = keyById(keyId);
  const bars: Note[][] = [];
  for (const bar of steps) {
    const notes: Note[] = [];
    for (const { step, offset, duration, tie } of bar) {
      const natural = naturalFromStaffStep(tonicStep + step);
      const alter = keyAlter(key, natural.letter) + offset;
      if (alter < -1 || alter > 1) return null;
      notes.push({ ...natural, alter: alter as Alter, duration, ...(tie ? { tie } : {}) });
    }
    bars.push(notes);
  }
  return bars;
}
