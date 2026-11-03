import { KEYS, MINOR_KEYS, signatureLetters } from "../music/keys";
import { midiNoteName } from "../music/pitch";
import { miniScore, scaleNotes, spellMidi, tonicNote, tonicOctave, type MiniType } from "./miniScore";
import type { Hand, HandChoice, Ornament, Piece, PieceNote } from "./piece";

/** Music to show on a card: bars of the piece with some notes picked out, or a score of its own. */
export type FeatureScore =
  | { kind: "bars"; from: number; to: number; highlight: number[]; repeats?: boolean }
  | { kind: "xml"; xml: string };

/** A short thing to play that introduces the feature, graded like a phrase and passed clean once. */
export interface FeatureDrill {
  score: FeatureScore;
  hand: HandChoice;
  label: string;
}

/** Something in the piece worth knowing before playing it: a card before the phrases. */
export interface PieceFeature {
  id: string;
  title: string;
  detail: string;
  example?: FeatureScore;
  drill?: FeatureDrill;
}

/** Note values from longest to shortest, as MusicXML names them, with how to say them. */
const NOTE_VALUES: readonly [string, string][] = [
  ["whole", "whole notes"],
  ["half", "half notes"],
  ["quarter", "quarter notes"],
  ["eighth", "eighths"],
  ["16th", "sixteenths"],
  ["32nd", "32nd notes"],
  ["64th", "64th notes"],
  ["128th", "128th notes"],
];

const ORNAMENT_NAMES: Record<Ornament, string> = {
  trill: "trills",
  mordent: "mordents",
  "upper-mordent": "upper mordents",
  turn: "turns",
  "inverted-turn": "inverted turns",
  "delayed-turn": "delayed turns",
  "delayed-inverted-turn": "delayed inverted turns",
};

const SIGN = { 1: "♯", [-1]: "♭" } as const;

function keyName(fifths: number, mode: "major" | "minor"): string {
  const keys = mode === "minor" ? MINOR_KEYS : KEYS;
  const key = keys.find((k) => k.signature === fifths);
  if (!key) return `${Math.abs(fifths)} ${fifths > 0 ? "sharps" : "flats"}`;
  const alter = key.alters[key.tonic];
  return `${key.tonic}${alter ? SIGN[alter] : ""} ${mode}`;
}

function signatureText(fifths: number): string {
  if (fifths === 0) return "no sharps or flats";
  const key = KEYS.find((k) => k.signature === fifths);
  const letters = key ? signatureLetters(key).map((letter) => `${letter}${SIGN[fifths > 0 ? 1 : -1]}`) : [];
  const count = `${Math.abs(fifths)} ${fifths > 0 ? "sharp" : "flat"}${Math.abs(fifths) === 1 ? "" : "s"}`;
  return letters.length ? `${count}: ${letters.join(" ")}` : count;
}

function list(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function range(notes: readonly PieceNote[]): string {
  const midis = notes.map((n) => n.midi);
  return `${midiNoteName(Math.min(...midis))} to ${midiNoteName(Math.max(...midis))}`;
}

/** A pitch outside its bar's key signature: a note that carries its own sharp, flat or natural. */
function outsideKey(piece: Piece, note: PieceNote): boolean {
  const { fifths } = piece.measures[note.measure];
  const key = KEYS.find((k) => k.signature === fifths);
  if (!key) return false;
  const tonic = KEY_TONIC_PC[key.tonic] + key.alters[key.tonic];
  return ![0, 2, 4, 5, 7, 9, 11].some((step) => (step + tonic + 12) % 12 === note.midi % 12);
}

const KEY_TONIC_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const CLEF_NAMES: Record<string, string> = {
  G2: "treble (G) clef",
  F4: "bass (F) clef",
  C3: "alto (C) clef",
  C4: "tenor (C) clef",
  C1: "soprano (C) clef",
  G1: "French violin clef",
  F3: "baritone clef",
};

/** The first bar with notes that `match`, and those notes in it (Piece.notes indices). */
function firstBar(piece: Piece, match: (note: PieceNote) => boolean): { measure: number; notes: number[]; hand: Hand } | null {
  const first = piece.notes.findIndex(match);
  if (first < 0) return null;
  const { measure, hand } = piece.notes[first];
  const notes = piece.notes.flatMap((note, i) => (note.measure === measure && match(note) ? [i] : []));
  return { measure, notes, hand };
}

/** A card for a kind of note: its first bar as the example, and that bar in its hand as the drill. */
function inFirstBar(piece: Piece, match: (note: PieceNote) => boolean, drill = true): Pick<PieceFeature, "example" | "drill"> {
  const bar = firstBar(piece, match);
  if (!bar) return {};
  const score: FeatureScore = { kind: "bars", from: bar.measure, to: bar.measure, highlight: bar.notes };
  const label = `bar ${piece.measures[bar.measure].label}`;
  return { example: score, ...(drill && { drill: { score, hand: bar.hand, label: `Play ${label}, ${bar.hand} hand` } }) };
}

/** What the piece asks of the player, in the order it's worth reading. */
export function pieceFeatures(piece: Piece): PieceFeature[] {
  const features: PieceFeature[] = [];
  const first = piece.measures[0];
  const { fifths, mode } = first;
  const openingBar: FeatureScore = { kind: "bars", from: 0, to: 0, highlight: [] };

  const clefs = [...new Set(piece.measures.flatMap((m) => [m.clefs.right, m.clefs.left]))];
  const changes = clefs.length > 2 ? ` The clef changes during the piece: it also uses the ${list(clefs.slice(2).map((c) => CLEF_NAMES[c] ?? c))}.` : "";
  features.push({
    id: "clefs",
    title: "Clefs",
    detail: `The top staff has the ${CLEF_NAMES[first.clefs.right] ?? first.clefs.right}, for the right hand; the bottom one the ${CLEF_NAMES[first.clefs.left] ?? first.clefs.left}, for the left. Middle C sits just between them.${changes}`,
    example: openingBar,
  });

  const keys = [...new Set(piece.measures.map((m) => `${m.fifths} ${m.mode}`))];
  const keyChanges = keys.length > 1 ? ` It changes key ${keys.length - 1} time${keys.length > 2 ? "s" : ""}.` : "";
  const up = scaleNotes(fifths, mode, tonicOctave(fifths, mode, "right"), 8, "quarter");
  const upLeft = scaleNotes(fifths, mode, tonicOctave(fifths, mode, "left"), 8, "quarter");
  const scale = miniScore({
    fifths,
    mode,
    beats: 4,
    beatType: 4,
    bars: [
      { right: up.slice(0, 4), left: upLeft.slice(0, 4) },
      { right: up.slice(4), left: upLeft.slice(4) },
      { right: [...up].reverse().slice(0, 4), left: [...upLeft].reverse().slice(0, 4) },
      { right: [...up].reverse().slice(4), left: [...upLeft].reverse().slice(4) },
    ],
  });
  features.push({
    id: "key",
    title: `Key: ${keyName(fifths, mode)}`,
    detail: `The signature has ${signatureText(fifths)}; they hold for every note on their line or space unless an accidental says otherwise.${keyChanges} Its scale, up and down:`,
    example: { kind: "xml", xml: scale },
    drill: { score: { kind: "xml", xml: scale }, hand: "right", label: `Play the ${keyName(fifths, mode)} scale` },
  });

  const times = [...new Set(piece.measures.map((m) => m.time))];
  const [top, bottom] = first.time.split("/").map(Number);
  const sign =
    first.timeSymbol === "common"
      ? "The C after the key signature isn't a clef: it's the sign for common time, 4/4. "
      : first.timeSymbol === "cut"
        ? "The ¢ after the key signature is cut time, 2/2: two half-note beats to a bar. "
        : "";
  const beatType = ({ 1: "whole", 2: "half", 4: "quarter", 8: "eighth", 16: "16th" } as const)[bottom] ?? "quarter";
  const tonic = tonicNote(fifths, mode, tonicOctave(fifths, mode, "right"), beatType);
  const beatsXml = miniScore({ fifths, mode, beats: top, beatType: bottom, symbol: first.timeSymbol, bars: [0, 1].map(() => ({ right: Array(top).fill(tonic) })) });
  features.push({
    id: "time",
    title: `Time: ${first.time}${first.timeSymbol === "common" ? ", written C" : first.timeSymbol === "cut" ? ", written ¢" : ""}`,
    detail: `${sign}${top} ${beatType === "eighth" ? "eighth" : beatType === "half" ? "half-note" : "quarter"} beat${top === 1 ? "" : "s"} to a bar; the count-in is one bar.${times.length > 1 ? ` It also uses ${list(times.slice(1))}.` : ""}`,
    example: openingBar,
    drill: { score: { kind: "xml", xml: beatsXml }, hand: "right", label: "Play on the beat" },
  });

  features.push({
    id: "tempo",
    title: piece.tempo ? `Tempo: ${piece.tempoText ? `${piece.tempoText}, ` : ""}♩ = ${Math.round(piece.tempo)}` : "Tempo: not given",
    detail: piece.tempo
      ? "This is the standard tempo. Slow practice plays at a share of it, set on the piece page."
      : `${piece.tempoText ? `The score says "${piece.tempoText}" but gives no number. ` : ""}Tap the tempo in on the piece page, or type it.`,
  });

  const right = piece.notes.filter((n) => n.hand === "right");
  const left = piece.notes.filter((n) => n.hand === "left");
  const lowHigh = (notes: readonly PieceNote[]) => [Math.min(...notes.map((n) => n.midi)), Math.max(...notes.map((n) => n.midi))];
  const [rLow, rHigh] = right.length ? lowHigh(right) : [0, 0];
  const [lLow, lHigh] = left.length ? lowHigh(left) : [0, 0];
  features.push({
    id: "range",
    title: "Range",
    detail: [right.length ? `Right hand ${range(right)}` : "", left.length ? `left hand ${range(left)}` : ""].filter(Boolean).join(", ") + ": the lowest and highest notes of each.",
    example: {
      kind: "xml",
      xml: miniScore({
        fifths,
        mode,
        beats: 4,
        beatType: 4,
        bars: [
          { right: right.length ? [spellMidi(rLow, fifths, "whole")] : [], left: left.length ? [spellMidi(lLow, fifths, "whole")] : [] },
          { right: right.length ? [spellMidi(rHigh, fifths, "whole")] : [], left: left.length ? [spellMidi(lHigh, fifths, "whole")] : [] },
        ],
      }),
    },
  });

  const types = new Set(piece.notes.map((n) => n.type));
  const values = NOTE_VALUES.filter(([type]) => types.has(type));
  const fastest = values.at(-1);
  if (fastest && NOTE_VALUES.findIndex(([type]) => type === fastest[0]) >= 4) {
    const fast = values.filter(([type]) => NOTE_VALUES.findIndex(([t]) => t === type) >= 4).map(([, name]) => name);
    // A ladder on the tonic: a beat each of quarters, eighths, sixteenths and (if used) 32nds.
    const t = (type: MiniType) => tonicNote(fifths, mode, tonicOctave(fifths, mode, "right"), type);
    const ladder = [t("quarter"), t("eighth"), t("eighth"), ...Array(4).fill(t("16th")), ...(types.has("32nd") ? Array(8).fill(t("32nd")) : [t("quarter")])];
    const ladderXml = miniScore({ fifths, mode, beats: 4, beatType: 4, bars: [{ right: ladder }, { right: ladder }] });
    features.push({
      id: "note-values",
      title: `Note values down to ${fastest[1]}`,
      detail: `Uses ${list(fast)}. Each extra beam halves the note: a quarter beat holds two eighths, four sixteenths or eight 32nds.`,
      example: { kind: "xml", xml: ladderXml },
      drill: { score: { kind: "xml", xml: ladderXml }, hand: "right", label: "Play the beat ladder" },
    });
  }

  const tuplets = piece.notes.filter((n) => n.tuplet).length;
  if (tuplets > 0) {
    features.push({
      id: "tuplets",
      title: "Tuplets",
      detail: `${tuplets} notes are in tuplets (such as triplets): squeezed evenly into the time of fewer notes.`,
      ...inFirstBar(piece, (n) => n.tuplet),
    });
  }

  for (const [name, hand] of [["Right", "right"], ["Left", "left"]] as const) {
    const chords = new Set(piece.notes.filter((n) => n.hand === hand && n.chord).map((n) => n.start)).size;
    if (chords > 0) {
      features.push({
        id: `chords-${hand}`,
        title: `${name} hand chords`,
        detail: `${chords} chord${chords === 1 ? "" : "s"} in the ${hand} hand. A chord counts once all its notes are down, together.`,
        ...inFirstBar(piece, (n) => n.hand === hand && n.chord),
      });
    }
  }

  const ties = piece.notes.filter((n) => n.tiedFrom).length;
  const firstTie = piece.notes.findIndex((n) => n.tieNext !== undefined);
  if (ties > 0 && firstTie >= 0) {
    // The first tie and the note it holds on into, over the barline if it crosses one.
    const held = piece.notes[firstTie].tieNext!;
    const from = piece.notes[firstTie].measure;
    const to = piece.notes[held].measure;
    const score: FeatureScore = { kind: "bars", from, to, highlight: [firstTie, held] };
    const hand = piece.notes[firstTie].hand;
    const bars = from === to ? `bar ${piece.measures[from].label}` : `bars ${piece.measures[from].label}–${piece.measures[to].label}`;
    features.push({
      id: "ties",
      title: "Ties",
      detail: `${ties} tied note${ties === 1 ? "" : "s"}: hold the key on through the tie; don't play it again.`,
      example: score,
      drill: { score, hand, label: `Play ${bars}, ${hand} hand` },
    });
  }

  const accidentals = piece.notes.filter((n) => outsideKey(piece, n)).length;
  if (accidentals > 0) {
    features.push({
      id: "accidentals",
      title: "Accidentals",
      detail: `${accidentals} note${accidentals === 1 ? "" : "s"} outside the key. An accidental lasts to the end of its bar.`,
      ...inFirstBar(piece, (n) => outsideKey(piece, n)),
    });
  }

  const graces = piece.notes.filter((n) => n.grace).length;
  if (graces > 0) {
    features.push({
      id: "grace",
      title: "Grace notes",
      detail: `${graces} small grace note${graces === 1 ? "" : "s"}. One on its own leans on the beat for its written value, and the note after comes that much later; a slashed one is quick. Play them, but they aren't graded.`,
      ...inFirstBar(piece, (n) => n.grace),
    });
  }

  const ornaments = [...new Set(piece.notes.map((n) => n.ornament).filter((o) => o !== undefined))];
  if (ornaments.length > 0) {
    features.push({
      id: "ornaments",
      title: `Ornaments: ${list(ornaments.map((o) => ORNAMENT_NAMES[o]))}`,
      detail: "A trill alternates quickly with the note above, starting from it; a mordent flicks once to the next note and back. Press Listen to hear them. Play them as you like: ornamented notes aren't graded.",
      ...inFirstBar(piece, (n) => n.ornament !== undefined),
    });
  }

  const repeatAt = piece.measures.findIndex((m) => m.repeatEnd);
  if (repeatAt >= 0) {
    const repeats = piece.measures.filter((m) => m.repeatEnd).length;
    const endings = piece.measures.some((m) => m.ending);
    features.push({
      id: "repeats",
      title: "Repeats",
      detail: `${repeats} repeat sign${repeats === 1 ? "" : "s"}${endings ? " with 1st and 2nd endings" : ""}: play back to the ‖: sign (or the start) once more. Phrases play once; the full piece takes the repeats.`,
      example: { kind: "bars", from: repeatAt, to: Math.min(repeatAt + 1, piece.measures.length - 1), highlight: [], repeats: true },
    });
  }
  return features;
}
