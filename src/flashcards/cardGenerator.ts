import { spanLevel } from "../curriculum/spans";
import type { Random } from "../music/generator";
import { keyAlter, keyById, type KeyInfo } from "../music/keys";
import { isBlackKey, midiOf, naturalFromStaffStep, staffStep } from "../music/pitch";
import type { Alter, Exercise, Note, Spelling } from "../music/types";
import type { Concept } from "./concepts";

/** Notes on a card: one bar of quarters in 4/4. */
export const CARD_NOTES = 4;
/** The keyboard shows at least this many white keys, however narrow the range tested. */
export const MIN_WINDOW_KEYS = 8;
/** At most this many: two octaves and a note. */
export const MAX_WINDOW_KEYS = 15;
/** Of a card's notes, at most this many are accidentals (a card with accidentals has at least one). */
const MAX_ACCIDENTALS = 2;

export interface Card {
  concept: Concept;
  /** One bar of four quarter notes, all different pitches and all on different lines or spaces. */
  exercise: Exercise;
  /** The notes' MIDI pitches in order: the answer. */
  pitches: number[];
  /**
   * The keys to draw: from a white key to a white key, a fixed number of white keys wide whatever
   * the card, so the edges don't say where the notes are. Every note lies inside it.
   */
  window: { lowest: number; highest: number };
}

/** How a note off the key signature may be written: sharps in sharp keys, flats in flat keys. */
function accidentalAlters(key: KeyInfo, letter: Spelling["letter"]): Alter[] {
  const inKey = keyAlter(key, letter);
  const options: Alter[] = key.signature < 0 ? [-1, 0] : [0, 1];
  return options.filter((alter) => {
    if (alter === inKey) return false;
    // Not E♯, B♯, F♭ or C♭ as an accidental: they are white keys under another name.
    return alter === 0 || isBlackKey(midiOf({ letter, alter, octave: 4 }));
  });
}

function shuffle<T>(items: readonly T[], random: Random): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * A fresh bar to test a concept. `keys` is how many white keys fit the screen: a phone shows
 * fewer than a desktop, and then a card only draws on part of the range (somewhere different
 * each time) so the keys stay big enough to hit.
 */
export function generateCard(concept: Concept, keys: number, random: Random = Math.random): Card {
  const key = keyById(concept.key);
  const level = spanLevel(concept.clef, concept.key, concept.span);
  const low = staffStep(level.lowest);
  const high = staffStep(level.highest);

  // The window: a run of white keys that holds the whole range, or part of it when that is wider.
  const width = Math.min(MAX_WINDOW_KEYS, Math.max(MIN_WINDOW_KEYS, keys));
  const rangeWidth = high - low + 1;
  const windowLow =
    width >= rangeWidth
      ? high - width + 1 + Math.floor(random() * (width - rangeWidth + 1))
      : low + Math.floor(random() * (rangeWidth - width + 1));
  const windowHigh = windowLow + width - 1;
  const window = {
    lowest: midiOf(naturalFromStaffStep(windowLow)),
    highest: midiOf(naturalFromStaffStep(windowHigh)),
  };

  // Lines and spaces to draw from: the range and the window both.
  const steps = Array.from({ length: Math.min(high, windowHigh) - Math.max(low, windowLow) + 1 }, (_, i) => Math.max(low, windowLow) + i);
  const diatonic = (step: number): Spelling => {
    const natural = naturalFromStaffStep(step);
    return { ...natural, alter: keyAlter(key, natural.letter) };
  };

  // A note can't sit outside the keys drawn (a B♭ on the window's lowest B, say), and two
  // notes can't share a key (B♮ and C♭ in G♭ major).
  const chosen = new Map<number, Spelling>();
  const used = new Set<number>();
  const take = (step: number, spelling: Spelling): void => {
    const midi = midiOf(spelling);
    if (chosen.has(step) || used.has(midi) || midi < window.lowest || midi > window.highest) return;
    chosen.set(step, spelling);
    used.add(midi);
  };
  if (concept.accidentals) {
    const candidates = shuffle(
      steps.flatMap((step) =>
        accidentalAlters(key, naturalFromStaffStep(step).letter).map((alter) => ({ step, spelling: { ...naturalFromStaffStep(step), alter } })),
      ),
      random,
    );
    const wanted = 1 + Math.floor(random() * MAX_ACCIDENTALS);
    for (const { step, spelling } of candidates) {
      if (chosen.size >= wanted) break;
      take(step, spelling);
    }
  }
  for (const step of shuffle(steps, random)) {
    if (chosen.size >= CARD_NOTES) break;
    take(step, diatonic(step));
  }

  const notes = shuffle([...chosen.values()], random).map((spelling): Note => ({ ...spelling, duration: "q" }));
  const exercise: Exercise = { clef: concept.clef, key: concept.key, time: "4/4", pickup: 0, bars: [notes] };
  return { concept, exercise, pitches: notes.map(midiOf), window };
}
