import { barBeats } from "../../src/music/rhythms";
import { staffStep } from "../../src/music/pitch";
import type { Duration, TimeSignature } from "../../src/music/types";
import {
  corpusFacts,
  fitsWindow,
  melodicFailure,
  RANGE_WINDOWS,
  type PhraseFacts,
  type RawPhrase,
  type RhythmBucket,
} from "./facts";

/**
 * Picks the phrases the app practises from and writes them in the compact form
 * src/music/corpus.ts reads. The choices here are the report's defaults.
 */

/** Melodic collections used at every rhythm level, in the order repeats are resolved. */
const MELODIC_COLLECTIONS = ["bach", "essenFolksong", "palestrina"];

/** Fiddle-tune books, used only where every bar is busy anyway. */
const BUSY_COLLECTIONS = ["oneills1850", "airdsAirs", "ryansMammoth"];

const MIN_NOTES = 6;
/** Curriculum phrases are four bars long, not counting a pickup. */
const PHRASE_BARS = 4;
const MIN_DISTINCT = 4;

const RHYTHMS: readonly RhythmBucket[] = ["basic", "eighths", "busy"];
const TIMES: readonly TimeSignature[] = ["4/4", "3/4", "2/2"];

const DURATIONS: Record<number, Duration> = { 4: "w", 3: "h.", 2: "h", 1.5: "q.", 1: "q", 0.5: "8" };

/** [id, source index, voice, clef (0 treble, 1 bass), time index, pickup beats, rhythm index, chromatic notes, window index, bars, notes, mode (0 major, 1 minor)] */
export type ExportedPhrase = [string, number, string, 0 | 1, number, number, number, number, number, number, string, 0 | 1];

export interface ExportedBank {
  v: 1;
  /** Range windows by index, narrowest first, as RANGE_WINDOWS lists them. */
  windows: string[];
  times: readonly TimeSignature[];
  rhythms: readonly RhythmBucket[];
  /** "Bach chorales and more: bwv269" and the like. */
  sources: string[];
  phrases: ExportedPhrase[];
}

export function wanted(facts: PhraseFacts): boolean {
  const { collection } = facts.phrase;
  if (!MELODIC_COLLECTIONS.includes(collection) && !(BUSY_COLLECTIONS.includes(collection) && facts.rhythm === "busy")) return false;
  return (
    facts.blockers.every((b) => b === "minor") &&
    facts.noteCount >= MIN_NOTES &&
    facts.bars === PHRASE_BARS &&
    facts.narrowest !== null &&
    melodicFailure(facts, MIN_DISTINCT) === null
  );
}

/**
 * Notes as "step[#|b]duration[~]" tokens, bars split by "|"; "~" ties a note to the next. Steps count staff positions from
 * the tonic (of the phrase's own mode), shifted by octaves so the phrase sits inside its
 * narrowest window; # and b are relative to the key signature. Null when a bar doesn't add up
 * (a mis-cut source bar).
 *
 * `chromatic` counts notes outside the key as a reader of that key expects it: in minor, the
 * raised 6th and 7th belong to the key (as the generator's leading tones do), so they don't count.
 */
export function encodeNotes(facts: PhraseFacts): { notes: string; pickup: number; chromatic: number } | null {
  const { phrase, key } = facts;
  const window = RANGE_WINDOWS.find((w) => w.id === facts.narrowest)!;
  const tonic = staffStep({ letter: phrase.analyzedKey.step, alter: 0, octave: 0 });
  const steps = phrase.notes.map((n) => staffStep({ letter: n.step, alter: 0, octave: n.octave }) - tonic);
  const low = Math.min(...steps);
  const high = Math.max(...steps);
  // An octave shift that puts the phrase inside its window (phraseFacts found that one exists).
  const shift = Math.ceil((high - window.high) / 7) * 7;
  if (!fitsWindow(low - shift, high - shift, { low: window.low, high: window.high })) return null;

  const full = barBeats(phrase.time as TimeSignature);
  const first = phrase.notes[0];
  const pickup = first.beat > 0 ? full - first.beat : 0;
  const bars: string[][] = [];
  const lengths: number[] = [];
  let chromatic = 0;
  let measure: number | null = null;
  for (const [i, n] of phrase.notes.entries()) {
    const duration = DURATIONS[n.ql];
    if (!duration || n.dots > 1) return null;
    if (n.measure !== measure) {
      bars.push([]);
      lengths.push(0);
      measure = n.measure;
    }
    const offset = n.alter - key.alters[n.step];
    if (offset < -1 || offset > 1) return null;
    const degree = (((steps[i] % 7) + 7) % 7) + 1;
    const minorScale = facts.mode === "minor" && offset === 1 && (degree === 6 || degree === 7);
    const continued = n.tie === "stop" || n.tie === "continue";
    if (offset !== 0 && !minorScale && !continued) chromatic++;
    const tied = n.tie === "start" || n.tie === "continue" ? "~" : "";
    bars[bars.length - 1].push(`${steps[i] - shift}${offset === 1 ? "#" : offset === -1 ? "b" : ""}${duration}${tied}`);
    lengths[lengths.length - 1] += n.ql;
  }
  // Every bar is full except a pickup at the start and an early end at the finish.
  const ok = lengths.every((length, i) => {
    if (i === 0 && pickup > 0) return length === pickup;
    if (i === lengths.length - 1) return length <= full;
    return length === full;
  });
  return ok ? { notes: bars.map((bar) => bar.join(" ")).join("|"), pickup, chromatic } : null;
}

/** Folk-song titles often come in capitals ("ICH FAHR DAHIN"); those read better in sentence case. */
export function readableTitle(title: string): string {
  if (title !== title.toUpperCase()) return title;
  const lower = title.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function exportBank(phrases: readonly RawPhrase[], labels: Record<string, string>): ExportedBank {
  const order = [...MELODIC_COLLECTIONS, ...BUSY_COLLECTIONS];
  const sorted = phrases
    .filter((p) => order.includes(p.collection))
    .sort((a, b) => order.indexOf(a.collection) - order.indexOf(b.collection));
  const sources: string[] = [];
  const sourceIndex = new Map<string, number>();
  const out: ExportedPhrase[] = [];
  for (const { facts, duplicateOf } of corpusFacts(sorted)) {
    if (duplicateOf || !wanted(facts)) continue;
    const encoded = encodeNotes(facts);
    if (!encoded) continue;
    const p = facts.phrase;
    const label = `${labels[p.collection] ?? p.collection}: ${p.title ? readableTitle(p.title) : p.work}`;
    if (!sourceIndex.has(label)) {
      sourceIndex.set(label, sources.length);
      sources.push(label);
    }
    out.push([
      p.id,
      sourceIndex.get(label)!,
      p.voice,
      p.clef === "treble" ? 0 : 1,
      TIMES.indexOf(p.time as TimeSignature),
      encoded.pickup,
      RHYTHMS.indexOf(facts.rhythm),
      encoded.chromatic,
      RANGE_WINDOWS.findIndex((w) => w.id === facts.narrowest),
      facts.bars,
      encoded.notes,
      facts.mode === "major" ? 0 : 1,
    ]);
  }
  return { v: 1, windows: RANGE_WINDOWS.map((w) => w.id), times: TIMES, rhythms: RHYTHMS, sources, phrases: out };
}
