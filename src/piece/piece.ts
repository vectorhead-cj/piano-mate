/** Staff 1 is the right hand, staff 2 the left; cross-staff notes aren't handled. */
export type Hand = "right" | "left";
export type HandChoice = Hand | "both";

export const HAND_LABELS: Record<HandChoice, string> = { left: "Left hand", right: "Right hand", both: "Both hands" };

/** A mordent goes down to the note below and back; an upper mordent up to the note above. */
export type Ornament = "trill" | "mordent" | "upper-mordent" | "turn" | "inverted-turn" | "delayed-turn" | "delayed-inverted-turn";

/** One written note. Times are in quarter beats from the start of the piece, in written order. */
export interface PieceNote {
  hand: Hand;
  midi: number;
  start: number;
  length: number;
  /** Index into Piece.measures. */
  measure: number;
  /** Quarter beats from its bar's start. */
  offset: number;
  /** The MusicXML note type, such as "16th"; absent on whole-bar rests and odd files. */
  type?: string;
  /** Held on from the note before through a tie, so it isn't pressed again. */
  tiedFrom: boolean;
  /** Index of the note this one is tied on to. */
  tieNext?: number;
  grace: boolean;
  /** A grace note with a slash through it: a quick crush on the beat, not a leaning appoggiatura. */
  acciaccatura?: boolean;
  /** Under a slur that goes on past it, so it's held into the next note. */
  slurred?: boolean;
  /** Part of a chord: another note in its hand starts with it. */
  chord: boolean;
  tuplet: boolean;
  ornament?: Ornament;
  /** An ornament's notes above and below, as MIDI: in the key, after the bar's accidentals and any written on the ornament. */
  upper?: number;
  lower?: number;
}

export interface PieceMeasure {
  /** The bar number as printed. */
  label: string;
  start: number;
  length: number;
  /** Quarter beats in a full bar of its time signature. */
  beats: number;
  time: string;
  /** The time signature is written as a sign: C for 4/4, ¢ for 2/2. */
  timeSymbol?: "common" | "cut";
  /** The clef on each staff, as its sign and line: "G2" (treble), "F4" (bass), "C3" (alto)… */
  clefs: { right: string; left: string };
  /** Sharps (+) or flats (−) in the key signature. */
  fifths: number;
  mode: "major" | "minor";
  repeatStart: boolean;
  repeatEnd: boolean;
  /** Which passes through a repeat take this bar (1st and 2nd endings); absent when every pass does. */
  ending?: number[];
  /** D.C., D.S., segno, coda or fine: jumps the play order doesn't follow. */
  jump: boolean;
}

export interface Piece {
  title: string;
  composer: string;
  /** Quarter beats per minute, from the file; absent when it gives none. */
  tempo?: number;
  /** The written tempo words, such as "Adagio e cantabile". */
  tempoText?: string;
  measures: PieceMeasure[];
  notes: PieceNote[];
  /** Things in the file that are left out, said once after import. */
  warnings: string[];
}

export function handOfStaff(staff: number): Hand {
  return staff === 2 ? "left" : "right";
}

export function inHand(note: PieceNote, hand: HandChoice): boolean {
  return hand === "both" || note.hand === hand;
}

/**
 * The bars a full play-through takes, in order: repeats once more, and 1st and 2nd endings
 * on their own pass. Pieces with D.C., D.S. or coda jumps fall back to written order.
 */
export function playOrder(measures: readonly PieceMeasure[]): number[] {
  if (measures.some((m) => m.jump)) return measures.map((_, i) => i);
  const order: number[] = [];
  /** Where the repeat being played goes back to, and which pass through it this is. */
  let sectionStart = 0;
  let pass = 1;
  const jumped = new Set<number>();
  // A runaway file can't loop forever: no bar is played more than a few times.
  const limit = measures.length * 4;
  let i = 0;
  while (i < measures.length && order.length < limit) {
    const measure = measures[i];
    if (measure.repeatStart && i !== sectionStart && pass === 1) sectionStart = i;
    if (measure.ending && !measure.ending.includes(pass)) {
      i++;
      continue;
    }
    order.push(i);
    // A plain end repeat goes back once; one closing an ending goes back on every pass it takes.
    if (measure.repeatEnd && (measure.ending !== undefined || !jumped.has(i))) {
      jumped.add(i);
      pass++;
      i = sectionStart;
      continue;
    }
    if (measure.repeatEnd || (measure.ending && !measures[i + 1]?.ending)) {
      // Past the repeat for good: the next one starts after it.
      sectionStart = i + 1;
      pass = 1;
    }
    i++;
  }
  return order;
}
