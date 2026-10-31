import type { Random } from "../music/generator";
import { keyAlter, keyById, relativeMajor, signatureLetters, type KeyInfo } from "../music/keys";
import { notesInKey, parseNotes, phraseInKey, type CorpusPhrase } from "../music/corpus";
import { NOTATION_LABELS, type Notation } from "../music/notation";
import { midiOf, naturalFromStaffStep, staffStep } from "../music/pitch";
import type { Alter, Clef, Exercise, Letter, TimeSignature } from "../music/types";
import { stagePool, stageTonicStep } from "./corpusSource";
import { keyFullName, stageNewKeys, type Stage } from "./curriculum";
import { spanLevel } from "./spans";

/** Intros are played back and echoed at this tempo. */
export const INTRO_TEMPO = 60;

interface Lesson {
  text: string;
  /** How to count the example, bar by bar; beats in brackets are held, not played. */
  count: string;
  /** The example, as steps from the tonic in phrases.json's notation. */
  notes: string;
  time?: TimeSignature;
  pickup?: number;
}

const LESSONS: Record<Notation, Lesson> = {
  quarter: {
    text: "A quarter note lasts one beat: one click of the metronome. Play a note on every click.",
    count: "1 2 3 4 | 1 2 3 4",
    notes: "0q 1q 2q 3q|4q 2q 1q 0q",
  },
  half: {
    text: "A half note lasts two beats. It has a hollow head and a stem. Play it on the first beat and hold it through the second.",
    count: "1 (2) 3 (4) | 1 2 3 (4)",
    notes: "0h 2h|4q 2q 0h",
  },
  whole: {
    text: "A whole note lasts a whole bar of 4/4: four beats. It has a hollow head and no stem. Play it on 1 and hold it until the next bar.",
    count: "1 2 3 (4) | 1 (2 3 4)",
    notes: "0q 2q 4h|0w",
  },
  "dotted-half": {
    text: "A dot makes a note half as long again. A dotted half note lasts three beats: play it on 1 and hold it through 2 and 3.",
    count: "1 (2 3) 4 | 1 (2 3 4)",
    notes: "0h. 2q|4w",
  },
  "three-four": {
    text: "The top number of a time signature is the beats in a bar, and the bottom number is the note that gets one beat. 3/4 has three quarter-note beats to a bar. Count 1 2 3, leaning on the 1.",
    count: "1 2 3 | 1 (2) 3 | 1 (2 3)",
    notes: "0q 1q 2q|4h 2q|0h.",
    time: "3/4",
  },
  pickup: {
    text: "Some phrases start before the first full bar. That short opening bar is a pickup. The count-in runs straight on into it, so here you come in on beat 4.",
    count: "(1 2 3) 4 | 1 (2) 3 4 | 1 (2 3 4)",
    notes: "4q|2h 1q 0q|0w",
    pickup: 1,
  },
  eighth: {
    text: "An eighth note lasts half a beat, so two fit in one click. They're usually beamed together in pairs. Count “and” between the beats: 1 & 2 &.",
    count: "1 & 2 & 3 (4) | 1 & 2 & 3 (4)",
    notes: "08 18 28 38 4h|48 38 28 18 0h",
  },
  "dotted-quarter": {
    text: "A dotted quarter note lasts a beat and a half. The eighth that usually follows it lands on the “and” of the next beat.",
    count: "1 (2) & 3 4 | 1 (2) & 3 (4)",
    notes: "0q. 18 2q 3q|4q. 38 2h",
  },
  tie: {
    text: "A curved line joining two notes of the same pitch is a tie. Play the first note and hold it through the second without playing it again, even across a barline.",
    count: "1 2 3 (4 | 1 2) 3 4",
    notes: "0q 2q 4h~|4h 2q 0q",
  },
  "cut-time": {
    text: "2/2, also called cut time, has two beats to a bar, each one a half note. It's written much like 4/4 but felt in two. The metronome still clicks quarters, so count them 1 & 2 &.",
    count: "1 (&) 2 (&) | 1 & 2 (&)",
    notes: "0h 2h|4q 2q 0h",
    time: "2/2",
  },
};

export interface IntroStep {
  title: string;
  text: string;
  count?: string;
  exercise: Exercise;
}

/** One octave up and back down in quarter notes, ending on the tonic partway through the last bar. */
const SCALE = "0q 1q 2q 3q|4q 5q 6q 7q|6q 5q 4q 3q|2q 1q 0q";
const SCALE_COUNT = "1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 1 2 3";
/** Minor scales raise the 7th (harmonic minor), as the curriculum's minor phrases do. */
const MINOR_SCALE = SCALE.replace(/\b6q/g, "6#q");

const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven"];
const ALTER_SIGN: Record<Alter, string> = { [-1]: "\u266D", 0: "\u266E", 1: "\u266F" };

function spelled(letter: Letter, alter: Alter): string {
  return `${letter}${alter === 0 ? "" : ALTER_SIGN[alter]}`;
}

/** "one sharp, F♯", "three flats, B♭, E♭ and A♭", "no sharps or flats" */
function signatureText(key: KeyInfo): string {
  const count = Math.abs(key.signature);
  if (count === 0) return "no sharps or flats";
  const kind = key.signature > 0 ? "sharp" : "flat";
  const names = signatureLetters(key).map((letter) => spelled(letter, keyAlter(key, letter)));
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  return `${COUNT_WORDS[count]} ${kind}${count > 1 ? "s" : ""}, ${list}`;
}

function scaleText(keyId: string): string {
  const key = keyById(keyId);
  const tonic = spelled(key.tonic, keyAlter(key, key.tonic));
  const play = `Play the scale from ${tonic} up an octave and back down, one note per beat.`;
  if (key.mode === "major") {
    const signature =
      key.signature === 0
        ? "C major has no sharps or flats: its scale is all white keys."
        : `${keyFullName(keyId)} has ${signatureText(key)}. They're written at the start of every line as the key signature and hold for the whole piece.`;
    return `${signature} ${play}`;
  }
  const seventh = naturalFromStaffStep(staffStep({ letter: key.tonic, alter: 0, octave: 4 }) + 6).letter;
  const alter = (keyAlter(key, seventh) + 1) as Alter;
  // Raising a flat from the signature gives a natural, which is written too (E♮ in F minor).
  const raised = `${seventh}${ALTER_SIGN[alter]}`;
  return (
    `${keyFullName(keyId)} shares its key signature with ${keyFullName(relativeMajor(key).id)}: ${signatureText(key)}. ` +
    `Minor keys usually raise their 7th note, here to ${raised}, written as an accidental each time. ${play}`
  );
}

/**
 * A stage's intro: a short example of each notation it introduces, in the stage's first key
 * and where its span starts, then the scale of each key it's the first to use, then a real
 * phrase from the stage. Empty for a stage that introduces nothing.
 */
export function introSteps(corpus: readonly CorpusPhrase[] | null, clef: Clef, stage: Stage, random: Random = Math.random): IntroStep[] {
  const newKeys = stageNewKeys(stage);
  if (stage.introduces.length === 0 && newKeys.length === 0) return [];
  const key = stage.keys[0];
  const tonic = stageTonicStep(clef, stage, key);
  const steps: IntroStep[] = stage.introduces.map((notation) => {
    const lesson = LESSONS[notation];
    const bars = notesInKey(parseNotes(lesson.notes), key, tonic);
    if (!bars) throw new Error(`The ${notation} example can't be written in ${key}`);
    return {
      title: NOTATION_LABELS[notation],
      text: lesson.text,
      count: lesson.count,
      exercise: { clef, key: keyById(key).id, time: lesson.time ?? "4/4", pickup: lesson.pickup ?? 0, bars },
    };
  });
  for (const scaleKey of newKeys) {
    // Where an octave stage would put it, so the scale sits on the staff.
    const scaleTonic = staffStep(spanLevel(clef, scaleKey, "octave").lowest);
    const minor = keyById(scaleKey).mode === "minor";
    const bars = notesInKey(parseNotes(minor ? MINOR_SCALE : SCALE), scaleKey, scaleTonic);
    if (!bars) throw new Error(`The ${scaleKey} scale can't be written`);
    steps.push({
      title: `The ${keyFullName(scaleKey)} scale`,
      text: scaleText(scaleKey),
      count: SCALE_COUNT,
      exercise: { clef, key: keyById(scaleKey).id, time: "4/4", pickup: 0, bars },
    });
  }
  // The real phrase is in the stage's first new key, when it has one.
  const realKey = newKeys[0] ?? key;
  const real = realPhrase(corpus, clef, stage, realKey, stageTonicStep(clef, stage, realKey), random);
  if (real) {
    steps.push({
      title: "Now a real phrase",
      text: "Here's a phrase from real music with what you've just met in it. Listen first if you like, then play it back.",
      exercise: real,
    });
  }
  return steps;
}

/** Keys to show for an intro: the stage's own, widened to every note its steps reach (scales go further). */
export function introMidiRange(steps: readonly IntroStep[], stageRange: { lowest: number; highest: number }): { lowest: number; highest: number } {
  const pitches = steps.flatMap((step) => step.exercise.bars.flat().map(midiOf));
  return { lowest: Math.min(stageRange.lowest, ...pitches), highest: Math.max(stageRange.highest, ...pitches) };
}

/** A phrase from the stage using as much of its new notation as any does (any phrase when it has none). */
function realPhrase(
  corpus: readonly CorpusPhrase[] | null,
  clef: Clef,
  stage: Stage,
  key: string,
  tonic: number,
  random: Random,
): Exercise | null {
  if (!corpus) return null;
  const pool = stagePool(corpus, clef, stage, keyById(key).mode, random);
  const uses = (phrase: CorpusPhrase) => stage.introduces.filter((n) => phrase.notations.has(n)).length;
  const most = Math.max(0, ...pool.map(uses));
  if (most === 0 && stage.introduces.length > 0) return null;
  const candidates = pool.filter((p) => uses(p) === most);
  for (let tries = 0; tries < candidates.length; tries++) {
    const exercise = phraseInKey(candidates[Math.floor(random() * candidates.length)], key, tonic);
    if (exercise) return exercise;
  }
  return null;
}
