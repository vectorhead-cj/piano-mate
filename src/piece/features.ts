import { KEYS, MINOR_KEYS, signatureLetters } from "../music/keys";
import { midiNoteName } from "../music/pitch";
import type { Piece, PieceNote } from "./piece";

/** Something in the piece worth knowing before playing it: a skippable card before the phrases. */
export interface PieceFeature {
  id: string;
  title: string;
  detail: string;
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

/** Pitches outside the key signature, the notes that carry their own sharp, flat or natural. */
function outsideKey(piece: Piece): number {
  return piece.notes.filter((note) => {
    const { fifths } = piece.measures[note.measure];
    const key = KEYS.find((k) => k.signature === fifths);
    if (!key) return false;
    const scale = new Set(
      [0, 2, 4, 5, 7, 9, 11].map((step) => (step + 12 + (KEY_TONIC_PC[key.tonic] + key.alters[key.tonic])) % 12),
    );
    return !scale.has(note.midi % 12);
  }).length;
}

const KEY_TONIC_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** What the piece asks of the player, in the order it's worth reading. */
export function pieceFeatures(piece: Piece): PieceFeature[] {
  const features: PieceFeature[] = [];
  const first = piece.measures[0];
  const keys = [...new Set(piece.measures.map((m) => `${m.fifths} ${m.mode}`))];
  const keyChanges = keys.length > 1 ? ` It changes key ${keys.length - 1} time${keys.length > 2 ? "s" : ""}.` : "";
  features.push({
    id: "key",
    title: `Key: ${keyName(first.fifths, first.mode)}`,
    detail: `The signature has ${signatureText(first.fifths)}; they hold for every note on their line or space unless an accidental says otherwise.${keyChanges}`,
  });

  const times = [...new Set(piece.measures.map((m) => m.time))];
  const common = first.time === "4/4" ? " (common time)" : "";
  features.push({
    id: "time",
    title: `Time: ${first.time}${common}`,
    detail: `${first.beats} quarter beats to a bar; the count-in is one bar.${times.length > 1 ? ` It also uses ${list(times.slice(1))}.` : ""}`,
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
  features.push({
    id: "range",
    title: "Range",
    detail: [right.length ? `Right hand ${range(right)}` : "", left.length ? `left hand ${range(left)}` : ""].filter(Boolean).join(", ") + ".",
  });

  const types = new Set(piece.notes.map((n) => n.type));
  const values = NOTE_VALUES.filter(([type]) => types.has(type));
  const shortest = values.at(-1);
  if (shortest && NOTE_VALUES.findIndex(([type]) => type === shortest[0]) >= 4) {
    const fast = values.filter(([type]) => NOTE_VALUES.findIndex(([t]) => t === type) >= 4).map(([, name]) => name);
    features.push({
      id: "note-values",
      title: `Note values down to ${shortest[1]}`,
      detail: `Uses ${list(fast)}. A sixteenth is a quarter of a beat; each extra beam halves it again.`,
    });
  }

  const tuplets = piece.notes.filter((n) => n.tuplet).length;
  if (tuplets > 0) {
    features.push({ id: "tuplets", title: "Tuplets", detail: `${tuplets} notes are in tuplets (such as triplets): squeezed evenly into the time of fewer notes.` });
  }

  for (const [hand, notes] of [["Right", right], ["Left", left]] as const) {
    const chords = new Set(notes.filter((n) => n.chord).map((n) => n.start)).size;
    if (chords > 0) {
      features.push({
        id: `chords-${hand.toLowerCase()}`,
        title: `${hand} hand chords`,
        detail: `${chords} chord${chords === 1 ? "" : "s"} in the ${hand.toLowerCase()} hand. A chord counts once all its notes are down, together.`,
      });
    }
  }

  const ties = piece.notes.filter((n) => n.tiedFrom).length;
  if (ties > 0) {
    features.push({ id: "ties", title: "Ties", detail: `${ties} tied note${ties === 1 ? "" : "s"}: hold the key on through the tie; don't play it again.` });
  }

  const accidentals = outsideKey(piece);
  if (accidentals > 0) {
    features.push({
      id: "accidentals",
      title: "Accidentals",
      detail: `${accidentals} note${accidentals === 1 ? "" : "s"} outside the key. An accidental lasts to the end of its bar.`,
    });
  }

  const graces = piece.notes.filter((n) => n.grace).length;
  if (graces > 0) {
    features.push({
      id: "grace",
      title: "Grace notes",
      detail: `${graces} small grace note${graces === 1 ? "" : "s"}, played quickly into the note after. Play them, but they aren't graded.`,
    });
  }

  const ornaments = [...new Set(piece.notes.map((n) => n.ornament).filter((o) => o !== undefined))];
  if (ornaments.length > 0) {
    features.push({
      id: "ornaments",
      title: `Ornaments: ${list(ornaments.map((o) => `${o}s`))}`,
      detail: "Play them as you like; only the written main note is graded, on its beat.",
    });
  }

  const repeats = piece.measures.filter((m) => m.repeatEnd).length;
  const endings = piece.measures.some((m) => m.ending);
  if (repeats > 0) {
    features.push({
      id: "repeats",
      title: "Repeats",
      detail: `${repeats} repeat sign${repeats === 1 ? "" : "s"}${endings ? " with 1st and 2nd endings" : ""}. Phrases play once; the full piece takes the repeats.`,
    });
  }
  return features;
}
