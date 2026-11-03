import { inHand, type HandChoice, type Piece, type PieceNote } from "./piece";

/** Quarter beats in a note value, for how long an appoggiatura leans. */
const VALUE_BEATS: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25, "32nd": 0.125, "64th": 0.0625 };
/** How long each quick grace note (a slashed one, or one of several) takes. */
const QUICK_GRACE_BEATS = 0.125;

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
  /**
   * Grace notes sounded on its beat, as Piece.notes indices, which push it `lead` quarter
   * beats later: `due` and `length` are where it then sounds.
   */
  graces?: { notes: number[]; lead: number };
}

/** Keys let through unmarked: an ungraded ornament's or grace note's, from `from` to `to` quarter beats. */
export interface Leeway {
  pitches: number[];
  from: number;
  to: number;
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
  /** Ornamented notes in the graded hands: played as the player likes, so not graded. */
  ungraded: Target[];
  leeway: Leeway[];
}

/** Written bars from..to (measure indices, inclusive), once each. */
export function barRange(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/**
 * How long grace notes before a note take from it. One plain grace note is an appoggiatura,
 * leaning on the beat for its written value, up to half the note; slashed or several are quick.
 */
export function graceLead(graces: readonly PieceNote[], main: number): number {
  if (graces.length === 1 && !graces[0].acciaccatura) return Math.min(VALUE_BEATS[graces[0].type ?? ""] ?? 0.5, main / 2);
  return Math.min(QUICK_GRACE_BEATS * graces.length, main / 2);
}

/**
 * The span through `order`. Tied-on notes aren't pressed again. Grace notes aren't graded, but
 * sound on the beat and push the note they lead into later; ornamented notes aren't graded.
 */
export function playSpan(piece: Piece, order: readonly number[], hand: HandChoice): PlaySpan {
  const byMeasure = new Map<number, number[]>();
  /** Grace notes by the bar, hand and time they lead into. */
  const graceAt = new Map<string, number[]>();
  const place = (note: PieceNote) => `${note.measure}|${note.hand}|${note.offset}`;
  piece.notes.forEach((note, i) => {
    if (note.grace) {
      graceAt.set(place(note), [...(graceAt.get(place(note)) ?? []), i]);
      return;
    }
    if (note.tiedFrom) return;
    const list = byMeasure.get(note.measure) ?? [];
    list.push(i);
    byMeasure.set(note.measure, list);
  });
  /** Which note each run of grace notes leads into: the nearest in pitch to the last of them. */
  const graceMain = new Map<number, number[]>();
  for (const [key, graces] of graceAt) {
    const [measure] = key.split("|");
    const last = piece.notes[graces[graces.length - 1]];
    let main = -1;
    for (const i of byMeasure.get(Number(measure)) ?? []) {
      if (place(piece.notes[i]) !== key) continue;
      if (main < 0 || Math.abs(piece.notes[i].midi - last.midi) < Math.abs(piece.notes[main].midi - last.midi)) main = i;
    }
    if (main >= 0) graceMain.set(main, graces);
  }

  const slotStarts: number[] = [];
  const targets: Target[] = [];
  const others: Target[] = [];
  const ungraded: Target[] = [];
  const leeway: Leeway[] = [];
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
      const graces = graceMain.get(index);
      if (graces) {
        const lead = graceLead(graces.map((g) => piece.notes[g]), length);
        target.graces = { notes: graces, lead };
        if (inHand(note, hand)) leeway.push({ pitches: graces.map((g) => piece.notes[g].midi), from: target.due, to: target.due + lead });
        target.due += lead;
        target.length -= lead;
      }
      if (!inHand(note, hand)) others.push(target);
      else if (note.ornament) {
        ungraded.push(target);
        leeway.push({ pitches: [note.midi, note.upper!, note.lower!], from: target.due, to: target.due + target.length });
      } else targets.push(target);
    }
    at += piece.measures[measure].length;
  });
  const byTime = (a: Target, b: Target) => a.due - b.due || a.pitch - b.pitch;
  return {
    order: [...order],
    slotStarts,
    length: at,
    targets: targets.sort(byTime),
    others: others.sort(byTime),
    ungraded: ungraded.sort(byTime),
    leeway,
  };
}
