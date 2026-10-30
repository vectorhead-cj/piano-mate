import { keyAlter, keyById } from "../music/keys";
import { midiOf, naturalFromStaffStep, staffStep } from "../music/pitch";
import type { Clef, Level, Spelling } from "../music/types";

/** Note ranges counted up from the key's home note (tonic), so "five" in G is G–D. */
export type SpanId = "five" | "octave" | "twelfth" | "two-octaves";

export interface Span {
  id: SpanId;
  label: string;
  /** Staff steps from the bottom note to the top note (five notes = 4 steps). */
  steps: number;
}

/** Narrowest first; each span contains the one before it. */
export const SPANS: readonly Span[] = [
  { id: "five", label: "Five notes", steps: 4 },
  { id: "octave", label: "One octave", steps: 7 },
  { id: "twelfth", label: "Octave and a fifth", steps: 11 },
  { id: "two-octaves", label: "Two octaves", steps: 14 },
];

export function spanById(id: SpanId): Span {
  const found = SPANS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown span: ${id}`);
  return found;
}

interface ClefWindow {
  /** Octave the span's bottom note starts in when it fits. */
  homeOctave: number;
  /** Lowest and highest staff steps a phrase should reach in this clef. */
  floor: number;
  ceiling: number;
}

const WINDOWS: Record<Clef, ClefWindow> = {
  // A3 to C6: a ledger line or two either side of the treble staff.
  treble: { homeOctave: 4, floor: staffStep({ letter: "A", alter: 0, octave: 3 }), ceiling: staffStep({ letter: "C", alter: 0, octave: 6 }) },
  // C2 to E4: the same reach around the bass staff.
  bass: { homeOctave: 3, floor: staffStep({ letter: "C", alter: 0, octave: 2 }), ceiling: staffStep({ letter: "E", alter: 0, octave: 4 }) },
};

/**
 * The span as a Level for the generator: it starts on the key's tonic in the clef's home
 * octave, or an octave lower or higher when that keeps it inside the clef's window.
 */
export function spanLevel(clef: Clef, keyId: string, spanId: SpanId): Level {
  const key = keyById(keyId);
  const span = spanById(spanId);
  const window = WINDOWS[clef];
  const overflow = (bottom: number) =>
    Math.max(0, window.floor - bottom) + Math.max(0, bottom + span.steps - window.ceiling);

  const home = staffStep({ letter: key.tonic, alter: 0, octave: window.homeOctave });
  let bottom = home;
  for (const candidate of [home - 7, home + 7]) {
    if (overflow(candidate) < overflow(bottom)) bottom = candidate;
  }

  const spell = (step: number): Spelling => {
    const natural = naturalFromStaffStep(step);
    return { ...natural, alter: keyAlter(key, natural.letter) };
  };
  const index = SPANS.indexOf(span);
  const inner = index > 0 ? SPANS[index - 1] : undefined;

  return {
    id: `span:${clef}:${keyId}:${spanId}`,
    name: span.label,
    clef,
    lowest: spell(bottom),
    highest: spell(bottom + span.steps),
    inner: inner ? { lowest: spell(bottom), highest: spell(bottom + inner.steps) } : undefined,
  };
}

/** MIDI range covering a span in every listed key, for sizing the keyboard. */
export function spanMidiRange(clef: Clef, keyIds: readonly string[], spanId: SpanId): { lowest: number; highest: number } {
  const levels = keyIds.map((k) => spanLevel(clef, k, spanId));
  return {
    lowest: Math.min(...levels.map((l) => midiOf(l.lowest))),
    highest: Math.max(...levels.map((l) => midiOf(l.highest))),
  };
}
