import type { Piece } from "./piece";

/**
 * Focus practice repeats a few notes picked out of a phrase, the click going on throughout.
 * The loop is whole bars, from the barline before the first note, so it always falls in time:
 *
 * - Starting in a bar's first half, the first time round gets a clean bar of count-in before.
 *   From the middle on, the start bar's beats before the first note are count-in enough.
 * - Ending at or before the middle of its bar, the rest of that bar counts in the next repeat.
 *   After the middle, a bar of clicks is added to count it in.
 */

/** One metronome click. */
export interface FocusClick {
  /** Quarter beats from the loop's start (the first time round's count-in bar is before 0). */
  at: number;
  /** First beat of a bar. */
  accent: boolean;
  /** "count" before the first note, "play" among the notes, "next" counting in the next repeat. */
  kind: "count" | "play" | "next";
  /** The bar it's in, as an index into `order`; the added count-in bar has none. */
  slot?: number;
}

export interface FocusPlan {
  /** Quarter beats into the phrase's span where the loop starts: the barline before `from`. */
  origin: number;
  /** The notes from `from` up to `to` quarter beats into the phrase's span. */
  from: number;
  to: number;
  /** Quarter beats in one time round the loop. */
  length: number;
  /** The clean count-in bar before the first time round, if it starts in a bar's first half. */
  intro: FocusClick[];
  /** One time round. */
  clicks: FocusClick[];
  /** The bar a time signature takes after the loop's last bar, for its added count-in; 0 without one. */
  extra: number;
  /** Time signature beats, for the click's bell on bars other than 4/4. */
  beatsPerBar: number;
}

/** Slight slack for comparing quarter-beat times. */
const EPS = 1e-6;

/**
 * The loop for picked-out notes, `from` and `to` quarter beats into a span over `order`'s bars
 * (`to` being where the next note after the last picked one starts, or the span's end).
 */
export function focusPlan(piece: Piece, order: readonly number[], from: number, to: number): FocusPlan {
  const starts: number[] = [];
  let at = 0;
  for (const measure of order) {
    starts.push(at);
    at += piece.measures[measure].length;
  }
  const slotOf = (beat: number) => {
    let slot = 0;
    while (slot < starts.length - 1 && starts[slot + 1] <= beat + EPS) slot++;
    return slot;
  };
  const first = slotOf(from);
  // A selection ending on a barline ends with the bar before it.
  const last = Math.max(first, slotOf(to - EPS));
  const origin = starts[first];
  const lengthOf = (slot: number) => piece.measures[order[slot]].length;
  const startsLate = from - starts[first] >= lengthOf(first) / 2 - EPS;
  const endsLate = to - starts[last] > lengthOf(last) / 2 + EPS;
  const beatsPerBar = piece.measures[order[first]].beats;
  const extra = endsLate ? piece.measures[order[last]].beats : 0;

  const kindAt = (beat: number): FocusClick["kind"] => (beat < from - origin - EPS ? "count" : beat < to - origin - EPS ? "play" : "next");
  const clicks: FocusClick[] = [];
  const bar = (start: number, length: number, slot?: number) => {
    for (let beat = 0; beat < length - EPS; beat++) clicks.push({ at: start + beat, accent: beat === 0, kind: kindAt(start + beat), slot });
  };
  for (let slot = first; slot <= last; slot++) bar(starts[slot] - origin, lengthOf(slot), slot);
  const loopBars = starts[last] + lengthOf(last) - origin;
  if (extra > 0) bar(loopBars, extra);

  const intro: FocusClick[] = [];
  if (!startsLate) for (let beat = 0; beat < beatsPerBar - EPS; beat++) intro.push({ at: beat - beatsPerBar, accent: beat === 0, kind: "count" });
  return { origin, from, to, length: loopBars + extra, intro, clicks, extra, beatsPerBar };
}
