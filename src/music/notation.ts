import type { Duration, TimeSignature } from "./types";

/**
 * Rhythm and meter notation a phrase can use. The curriculum introduces each one at a
 * stage, and a stage only plays phrases whose notation has been introduced by then.
 * 4/4 isn't listed: every phrase without another signature is in it.
 */
export type Notation =
  | "whole"
  | "half"
  | "quarter"
  | "dotted-half"
  | "three-four"
  | "pickup"
  | "eighth"
  | "dotted-quarter"
  | "tie"
  | "cut-time";

export const NOTATION_LABELS: Record<Notation, string> = {
  whole: "Whole notes",
  half: "Half notes",
  quarter: "Quarter notes",
  "dotted-half": "Dotted half notes",
  "three-four": "3/4 time",
  pickup: "Pickup bars",
  eighth: "Eighth notes",
  "dotted-quarter": "Dotted quarter notes",
  tie: "Ties",
  "cut-time": "Cut time (2/2)",
};

const DURATION_NOTATION: Record<Duration, Notation> = {
  w: "whole",
  "h.": "dotted-half",
  h: "half",
  "q.": "dotted-quarter",
  q: "quarter",
  "8": "eighth",
};

const TIME_NOTATION: Record<TimeSignature, Notation | null> = {
  "4/4": null,
  "3/4": "three-four",
  "2/2": "cut-time",
};

/** The note values allowed by a set of notation, in the order of Duration. */
export function allowedDurations(notations: ReadonlySet<Notation>): Duration[] {
  return (Object.keys(DURATION_NOTATION) as Duration[]).filter((d) => notations.has(DURATION_NOTATION[d]));
}

/** Every notation a phrase uses. */
export function notationsOf(
  time: TimeSignature,
  pickup: number,
  bars: readonly (readonly { duration: Duration; tie?: boolean }[])[],
): Set<Notation> {
  const found = new Set<Notation>();
  const meter = TIME_NOTATION[time];
  if (meter) found.add(meter);
  if (pickup > 0) found.add("pickup");
  for (const bar of bars) {
    for (const note of bar) {
      found.add(DURATION_NOTATION[note.duration]);
      if (note.tie) found.add("tie");
    }
  }
  return found;
}

export function usesOnly(used: ReadonlySet<Notation>, allowed: ReadonlySet<Notation>): boolean {
  for (const notation of used) if (!allowed.has(notation)) return false;
  return true;
}
