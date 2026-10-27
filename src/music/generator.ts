import {
  ACCIDENTAL_FREQUENCY_CHANCE,
  keyAlter,
  keyById,
  majorTriadLetters,
  relativeMinorTonic,
  type KeyInfo,
} from "./keys";
import { midiOf, naturalFromStaffStep, staffStep } from "./pitch";
import { BEATS, BEATS_PER_BAR, rhythmById, type RhythmProfile } from "./rhythms";
import type {
  AccidentalFrequency,
  Alter,
  Duration,
  Exercise,
  Level,
  Note,
  RhythmFlavor,
  Spelling,
} from "./types";

export interface GeneratorOptions {
  bars: number;
  key: string;
  accidentalFrequency: AccidentalFrequency;
  rhythm: RhythmFlavor;
}

export type Random = () => number;

/** Melodic motion in staff steps: mostly steps, some thirds, rare larger leaps. */
const INTERVAL_WEIGHTS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 7],
  [-1, 7],
  [2, 2],
  [-2, 2],
  [3, 1],
  [-3, 1],
  [4, 0.5],
  [-4, 0.5],
];

export function generateExercise(
  level: Level,
  options: GeneratorOptions,
  random: Random = Math.random,
): Exercise {
  const key = keyById(options.key);
  const rhythm = rhythmById(options.rhythm);
  const rhythms = Array.from({ length: options.bars }, (_, i) =>
    generateBarRhythm(rhythm, i === options.bars - 1, random),
  );
  const noteCount = rhythms.reduce((sum, bar) => sum + bar.length, 0);
  const pitches = generatePitches(level, key, noteCount, options.accidentalFrequency, random);

  let pitchIndex = 0;
  const bars: Note[][] = rhythms.map((barRhythm) =>
    barRhythm.map((duration) => ({ ...pitches[pitchIndex++], duration })),
  );

  return { clef: level.clef, key: key.id, beatsPerBar: BEATS_PER_BAR, bars };
}

function generateBarRhythm(
  profile: RhythmProfile,
  isLastBar: boolean,
  random: Random,
): Duration[] {
  let remaining = BEATS_PER_BAR;
  const finalDuration = isLastBar ? pickFinalDuration(profile.durations) : null;
  if (finalDuration) remaining -= BEATS[finalDuration];

  const rhythm: Duration[] = [];
  while (remaining > 0) {
    const fitting = profile.durations.filter((d) => BEATS[d] <= remaining);
    if (fitting.length === 0) throw new Error("Rhythm flavor cannot fill a bar");
    const duration = pickWeighted(
      fitting.map((d) => [d, profile.weights[d]] as const),
      random,
    );
    rhythm.push(duration);
    remaining -= BEATS[duration];
  }

  if (finalDuration) rhythm.push(finalDuration);
  return rhythm;
}

/** A phrase should end on a long-ish note, but not swallow the whole last bar. */
function pickFinalDuration(allowed: readonly Duration[]): Duration {
  for (const preferred of ["h", "w", "q"] as const) {
    if (allowed.includes(preferred)) return preferred;
  }
  throw new Error("Rhythm flavor has no long ending duration");
}

function generatePitches(
  level: Level,
  key: KeyInfo,
  count: number,
  frequency: AccidentalFrequency,
  random: Random,
): Spelling[] {
  const low = staffStep(level.lowest);
  const high = staffStep(level.highest);
  const inRange = (step: number) => step >= low && step <= high;
  const stepsInRange = Array.from({ length: high - low + 1 }, (_, i) => low + i);

  const triad = new Set(majorTriadLetters(key.tonic));
  const startOptions = stepsInRange.filter((s) => triad.has(naturalFromStaffStep(s).letter));
  const endOptions = endingSteps(stepsInRange, key);

  const steps: number[] = [pickUniform(startOptions.length > 0 ? startOptions : stepsInRange, random)];
  for (let i = 1; i < count - 1; i++) {
    const previous = steps[i - 1];
    const options = INTERVAL_WEIGHTS.filter(([interval]) => inRange(previous + interval));
    steps.push(previous + pickWeighted(options, random));
  }
  if (count > 1) {
    const previous = steps[count - 2];
    steps.push(nearest(endOptions, previous));
  } else {
    steps[0] = pickUniform(endOptions, random);
  }

  const spellings = steps.map((step) => diatonicSpelling(step, key));
  addChromaticApproaches(spellings, steps, key, frequency, random);
  return spellings;
}

/**
 * Prefer the major tonic in range; else the relative-minor tonic; else the
 * major triad. Extreme keys may have their tonic letter outside a narrow range.
 */
function endingSteps(stepsInRange: number[], key: KeyInfo): number[] {
  const byLetter = (letter: string) =>
    stepsInRange.filter((s) => naturalFromStaffStep(s).letter === letter);
  const tonic = byLetter(key.tonic);
  if (tonic.length > 0) return tonic;
  const relative = byLetter(relativeMinorTonic(key.tonic));
  if (relative.length > 0) return relative;
  const triad = new Set(majorTriadLetters(key.tonic));
  const triadSteps = stepsInRange.filter((s) => triad.has(naturalFromStaffStep(s).letter));
  return triadSteps.length > 0 ? triadSteps : stepsInRange;
}

function diatonicSpelling(step: number, key: KeyInfo): Spelling {
  const natural = naturalFromStaffStep(step);
  return { ...natural, alter: keyAlter(key, natural.letter) };
}

/**
 * Raise a note that steps up to the next one, or lower one that steps down,
 * relative to the key. That covers chromatic approaches (F♯→G in C) and
 * "resets" that cancel the key (F♮→E in G). Only used when the diatonic
 * step is a whole tone (so E→F and B→C never get an extra sharp/flat).
 * First and last notes stay diatonic.
 */
function addChromaticApproaches(
  spellings: Spelling[],
  steps: number[],
  key: KeyInfo,
  frequency: AccidentalFrequency,
  random: Random,
): void {
  const chance = ACCIDENTAL_FREQUENCY_CHANCE[frequency];
  if (chance === 0) return;

  for (let i = 1; i < spellings.length - 1; i++) {
    if (random() >= chance) continue;
    const motion = steps[i + 1] - steps[i];
    if (motion !== 1 && motion !== -1) continue;

    const current = spellings[i];
    const next = spellings[i + 1];
    const diatonic = keyAlter(key, current.letter);
    const gap = Math.abs(
      midiOf({ ...next, alter: keyAlter(key, next.letter) }) -
        midiOf({ ...current, alter: diatonic }),
    );
    if (gap !== 2) continue;

    const alter = (diatonic + motion) as Alter;
    if (alter < -1 || alter > 1 || alter === diatonic) continue;
    spellings[i] = { ...current, alter };
  }
}

function nearest(candidates: number[], target: number): number {
  return candidates.reduce((best, c) => (Math.abs(c - target) < Math.abs(best - target) ? c : best));
}

function pickUniform<T>(items: readonly T[], random: Random): T {
  return items[Math.floor(random() * items.length)];
}

function pickWeighted<T>(options: readonly (readonly [T, number])[], random: Random): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let remaining = random() * total;
  for (const [value, weight] of options) {
    remaining -= weight;
    if (remaining < 0) return value;
  }
  return options[options.length - 1][0];
}
