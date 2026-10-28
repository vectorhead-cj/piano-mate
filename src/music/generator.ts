import {
  ACCIDENTAL_FREQUENCY_CHANCE,
  keyAlter,
  keyById,
  majorTriadLetters,
  relativeMinorTonic,
  type KeyInfo,
} from "./keys";
import { midiOf, naturalFromStaffStep, staffStep } from "./pitch";
import {
  BEATS,
  BEATS_PER_BAR,
  cellsForBar,
  rhythmById,
  type RhythmCell,
  type RhythmProfile,
} from "./rhythms";
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

/** Leap size (staff steps) that triggers opposite-step recovery. */
const LEAP_RECOVER_AT = 3;

/** Fraction of the phrase after which gravity toward the tonic ramps up. */
const GRAVITY_START = 0.6;

/** Peak of the phrase arch, as a fraction of note indices. */
const ARCH_PEAK_AT = 0.4;

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
  const durations = rhythms.flat();
  const pitches = generatePitches(level, key, durations, options.accidentalFrequency, random);

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
  const cell = pickWeightedCell(cellsForBar(profile, isLastBar), random);
  return [...cell.pattern];
}

function pickWeightedCell(cells: readonly RhythmCell[], random: Random): RhythmCell {
  return pickWeighted(
    cells.map((c) => [c, c.weight] as const),
    random,
  );
}

function generatePitches(
  level: Level,
  key: KeyInfo,
  durations: readonly Duration[],
  frequency: AccidentalFrequency,
  random: Random,
): Spelling[] {
  const count = durations.length;
  const low = staffStep(level.lowest);
  const high = staffStep(level.highest);
  const inRange = (step: number) => step >= low && step <= high;
  const stepsInRange = Array.from({ length: high - low + 1 }, (_, i) => low + i);

  const triad = new Set(majorTriadLetters(key.tonic));
  const startOptions = stepsInRange.filter((s) => triad.has(naturalFromStaffStep(s).letter));
  const endOptions = endingSteps(stepsInRange, key);
  const endTarget = pickUniform(endOptions, random);
  const peakTarget = pickPeakTarget(stepsInRange, low, high, random);
  const peakIndex = Math.max(1, Math.round((count - 1) * ARCH_PEAK_AT));

  if (count === 1) {
    return [diatonicSpelling(endTarget, key)];
  }

  // Prefer a lower start so the arch has room to rise (when the range allows).
  const startPool = startOptions.length > 0 ? startOptions : stepsInRange;
  const lowerStarts = startPool.filter((s) => s <= (low + high) / 2);
  const steps: number[] = [
    pickUniform(lowerStarts.length > 0 ? lowerStarts : startPool, random),
  ];

  for (let i = 1; i < count - 1; i++) {
    const previous = steps[i - 1];
    if (i === count - 2) {
      const maxApproach = BEATS[durations[i]] <= 0.5 ? 2 : 4;
      steps.push(pickApproach(previous, endTarget, inRange, random, maxApproach));
      continue;
    }

    const incoming = i >= 2 ? previous - steps[i - 2] : 0;
    const guide = i <= peakIndex ? peakTarget : endTarget;
    const strength =
      i <= peakIndex ? 0.35 + 0.45 * (i / peakIndex) : melodicGravity(i, count);

    let options = INTERVAL_WEIGHTS.filter(([interval]) => inRange(previous + interval));

    // No wide leaps onto the shortest note values (eighths).
    if (BEATS[durations[i]] <= 0.5) {
      const stepwise = options.filter(([interval]) => Math.abs(interval) <= 2);
      if (stepwise.length > 0) {
        options = stepwise;
      } else {
        // Range edge: only leaps fit — take the smallest available motion.
        const smallest = Math.min(...options.map(([interval]) => Math.abs(interval)));
        options = options.filter(([interval]) => Math.abs(interval) === smallest);
      }
    }

    // After a leap, recover with a step (or third) the other way when possible.
    if (Math.abs(incoming) >= LEAP_RECOVER_AT) {
      const recoverDir = -Math.sign(incoming);
      const recovery = options.filter(
        ([interval]) => Math.sign(interval) === recoverDir && Math.abs(interval) <= 2,
      );
      if (recovery.length > 0) options = recovery;
    }

    const weighted = options.map(([interval, weight]) => {
      const next = previous + interval;
      const before = Math.abs(previous - guide);
      const after = Math.abs(next - guide);
      let factor = 1;
      if (after < before) factor = 1 + strength * 3;
      else if (after > before) factor = 1 / (1 + strength * 2);
      return [interval, weight * factor] as const;
    });

    steps.push(previous + pickWeighted(weighted, random));
  }

  steps.push(endTarget);

  const spellings = steps.map((step) => diatonicSpelling(step, key));
  addChromaticApproaches(spellings, steps, key, frequency, random);
  return spellings;
}

/** Soft peak in the upper half of the range (falls back to midrange if tiny). */
function pickPeakTarget(
  stepsInRange: number[],
  low: number,
  high: number,
  random: Random,
): number {
  const mid = Math.ceil((low + high) / 2);
  const upper = stepsInRange.filter((s) => s >= mid);
  return pickUniform(upper.length > 0 ? upper : stepsInRange, random);
}

/** 0 before GRAVITY_START, then ramps to 1 at the penultimate note. */
function melodicGravity(index: number, count: number): number {
  const start = Math.floor((count - 1) * GRAVITY_START);
  if (index < start) return 0;
  const span = count - 2 - start;
  if (span <= 0) return 1;
  return (index - start) / span;
}

/**
 * Prefer a step into the tonic, then a third, else the closest in-range pitch
 * that still ends on endTarget (caller appends endTarget separately).
 */
function pickApproach(
  previous: number,
  endTarget: number,
  inRange: (step: number) => boolean,
  random: Random,
  maxApproach = 4,
): number {
  const deltas = [-1, 1, -2, 2, -3, 3, -4, 4].filter((d) => Math.abs(d) <= maxApproach);
  for (const maxDelta of [1, 2, maxApproach]) {
    const candidates = deltas
      .filter((d) => Math.abs(d) <= maxDelta)
      .map((d) => endTarget - d)
      .filter((step) => inRange(step) && Math.abs(step - previous) <= maxApproach);
    if (candidates.length > 0) return pickUniform(candidates, random);
  }
  // Stay put rather than leaping onto a short note; the final tonic may then leap.
  return previous;
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
