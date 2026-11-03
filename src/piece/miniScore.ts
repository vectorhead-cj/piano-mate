import { KEYS, MINOR_KEYS } from "../music/keys";
import { LETTERS } from "../music/pitch";
import type { Letter } from "../music/types";

/** Note values a mini score can hold, as MusicXML names them, with their length in 32nds. */
const LENGTHS = { whole: 32, half: 16, quarter: 8, eighth: 4, "16th": 2, "32nd": 1 } as const;
export type MiniType = keyof typeof LENGTHS;

export interface MiniNote {
  step: Letter;
  alter: number;
  octave: number;
  type: MiniType;
}

/** One bar: the right hand's notes, and the left's; a hand left empty rests. */
export interface MiniBar {
  right: MiniNote[];
  left?: MiniNote[];
}

export interface MiniScore {
  fifths: number;
  mode: "major" | "minor";
  beats: number;
  beatType: number;
  symbol?: "common" | "cut";
  bars: MiniBar[];
}

/** Divisions per quarter: a 32nd is one. */
const DIVISIONS = 8;

function noteXml(note: MiniNote, staff: number): string {
  const alter = note.alter ? `<alter>${note.alter}</alter>` : "";
  return `<note><pitch><step>${note.step}</step>${alter}<octave>${note.octave}</octave></pitch><duration>${LENGTHS[note.type]}</duration><voice>${staff}</voice><type>${note.type}</type><staff>${staff}</staff></note>`;
}

function restXml(staff: number, beats: number): string {
  return `<note><rest measure="yes"/><duration>${beats * DIVISIONS}</duration><voice>${staff}</voice><staff>${staff}</staff></note>`;
}

/** A two-staff MusicXML score from a few bars: for the intro cards' examples and drills. */
export function miniScore(score: MiniScore): string {
  const quarters = (score.beats * 4) / score.beatType;
  const symbol = score.symbol ? ` symbol="${score.symbol}"` : "";
  const measures = score.bars
    .map((bar, i) => {
      const attributes =
        i === 0
          ? `<attributes><divisions>${DIVISIONS}</divisions><key><fifths>${score.fifths}</fifths><mode>${score.mode}</mode></key><time${symbol}><beats>${score.beats}</beats><beat-type>${score.beatType}</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`
          : "";
      const right = bar.right.length ? bar.right.map((n) => noteXml(n, 1)).join("") : restXml(1, quarters);
      const left = bar.left?.length ? bar.left.map((n) => noteXml(n, 2)).join("") : restXml(2, quarters);
      return `<measure number="${i + 1}">${attributes}${right}<backup><duration>${quarters * DIVISIONS}</duration></backup>${left}</measure>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name></part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}

function keyOf(fifths: number, mode: "major" | "minor") {
  return (mode === "minor" ? MINOR_KEYS : KEYS).find((k) => k.signature === fifths) ?? KEYS[0];
}

/** The key's scale from its tonic in `octave`, `count` notes up, spelled from the signature. */
export function scaleNotes(fifths: number, mode: "major" | "minor", octave: number, count: number, type: MiniType): MiniNote[] {
  const key = keyOf(fifths, mode);
  const start = LETTERS.indexOf(key.tonic);
  return Array.from({ length: count }, (_, i) => {
    const letter = LETTERS[(start + i) % 7];
    return { step: letter, alter: key.alters[letter], octave: octave + Math.floor((start + i) / 7), type };
  });
}

/** The key's tonic in `octave`. */
export function tonicNote(fifths: number, mode: "major" | "minor", octave: number, type: MiniType): MiniNote {
  return scaleNotes(fifths, mode, octave, 1, type)[0];
}

/** The octave that puts a tonic comfortably on a staff: treble from octave 4, bass from 2 or 3. */
export function tonicOctave(fifths: number, mode: "major" | "minor", hand: "right" | "left"): number {
  const tonic = LETTERS.indexOf(keyOf(fifths, mode).tonic);
  return hand === "right" ? 4 : tonic >= LETTERS.indexOf("F") ? 2 : 3;
}

const SHARP_NAMES: readonly [Letter, number][] = [
  ["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0], ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0],
];
const FLAT_NAMES: readonly [Letter, number][] = [
  ["C", 0], ["D", -1], ["D", 0], ["E", -1], ["E", 0], ["F", 0], ["G", -1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0],
];

/** A MIDI pitch spelled with sharps in sharp keys and flats in flat ones. */
export function spellMidi(midi: number, fifths: number, type: MiniType): MiniNote {
  const [step, alter] = (fifths < 0 ? FLAT_NAMES : SHARP_NAMES)[midi % 12];
  return { step, alter, octave: Math.floor(midi / 12) - 1, type };
}
