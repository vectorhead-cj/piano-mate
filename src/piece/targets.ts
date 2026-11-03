import { inHand, type HandChoice, type Piece } from "./piece";

/** One key to press: a note, held on through any ties after it. Times are in quarter beats from the span's start. */
export interface Target {
  pitch: number;
  due: number;
  length: number;
  hand: "left" | "right";
  /** The written notes it covers, the first and those tied on from it, as Piece.notes indices. */
  notes: number[];
  /** Which bar of the span it's in: an index into PlaySpan.order. */
  slot: number;
}

/** Bars to play, in order, with the keys to press in them. */
export interface PlaySpan {
  /** Measure indices; a bar can come more than once when repeats are taken. */
  order: number[];
  /** Quarter beats from the span's start to each bar in `order`. */
  slotStarts: number[];
  length: number;
  /** The hand or hands being graded. */
  targets: Target[];
  /** The other hand, when one hand is practised: played by the synth, and its keys ignored. */
  others: Target[];
}

/** Written bars from..to (measure indices, inclusive), once each. */
export function barRange(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** The span through `order`: grace notes aren't graded, and tied-on notes aren't pressed again. */
export function playSpan(piece: Piece, order: readonly number[], hand: HandChoice): PlaySpan {
  const byMeasure = new Map<number, number[]>();
  piece.notes.forEach((note, i) => {
    if (note.grace || note.tiedFrom) return;
    const list = byMeasure.get(note.measure) ?? [];
    list.push(i);
    byMeasure.set(note.measure, list);
  });
  const slotStarts: number[] = [];
  const targets: Target[] = [];
  const others: Target[] = [];
  let at = 0;
  order.forEach((measure, slot) => {
    slotStarts.push(at);
    for (const index of byMeasure.get(measure) ?? []) {
      const note = piece.notes[index];
      const notes = [index];
      let length = note.length;
      // A tie on into a bar the span doesn't take next (the end of a repeat) is still held its written length.
      for (let next = note.tieNext; next !== undefined && next >= 0; next = piece.notes[next].tieNext) {
        notes.push(next);
        length += piece.notes[next].length;
      }
      const target: Target = { pitch: note.midi, due: at + note.offset, length, hand: note.hand, notes, slot };
      (inHand(note, hand) ? targets : others).push(target);
    }
    at += piece.measures[measure].length;
  });
  const byTime = (a: Target, b: Target) => a.due - b.due || a.pitch - b.pitch;
  return { order: [...order], slotStarts, length: at, targets: targets.sort(byTime), others: others.sort(byTime) };
}
