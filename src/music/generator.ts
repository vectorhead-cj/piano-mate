import { naturalFromStaffStep, staffStep } from "./pitch";
import type { Alter, Duration, Exercise, Level, Note, Spelling } from "./types";

export interface GeneratorOptions {
  bars: number;
  accidentals: boolean;
}

export type Random = () => number;

const BEATS_PER_BAR = 4;
const BEATS: Record<Duration, number> = { w: 4, h: 2, q: 1 };
const DURATION_WEIGHTS: Record<Duration, number> = { q: 5, h: 3, w: 1 };

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

const ACCIDENTAL_PROBABILITY = 0.2;
const TONIC_TRIAD_LETTERS = new Set(["C", "E", "G"]);

export function generateExercise(
  level: Level,
  options: GeneratorOptions,
  random: Random = Math.random,
): Exercise {
  const rhythms = Array.from({ length: options.bars }, (_, i) =>
    generateBarRhythm(level.durations, i === options.bars - 1, random),
  );
  const noteCount = rhythms.reduce((sum, bar) => sum + bar.length, 0);
  const pitches = generatePitches(level, noteCount, options.accidentals, random);

  let pitchIndex = 0;
  const bars: Note[][] = rhythms.map((rhythm) =>
    rhythm.map((duration) => ({ ...pitches[pitchIndex++], duration })),
  );

  return { clef: level.clef, beatsPerBar: BEATS_PER_BAR, bars };
}

function generateBarRhythm(allowed: Duration[], isLastBar: boolean, random: Random): Duration[] {
  let remaining = BEATS_PER_BAR;
  const finalDuration = isLastBar ? pickFinalDuration(allowed) : null;
  if (finalDuration) remaining -= BEATS[finalDuration];

  const rhythm: Duration[] = [];
  while (remaining > 0) {
    const fitting = allowed.filter((d) => BEATS[d] <= remaining);
    if (fitting.length === 0) throw new Error("Level durations cannot fill a bar");
    const duration = pickWeighted(
      fitting.map((d) => [d, DURATION_WEIGHTS[d]] as const),
      random,
    );
    rhythm.push(duration);
    remaining -= BEATS[duration];
  }

  if (finalDuration) rhythm.push(finalDuration);
  return rhythm;
}

/** A phrase should end on a long-ish note, but not swallow the whole last bar. */
function pickFinalDuration(allowed: Duration[]): Duration {
  for (const preferred of ["h", "w", "q"] as const) {
    if (allowed.includes(preferred)) return preferred;
  }
  throw new Error("Level has no durations");
}

function generatePitches(
  level: Level,
  count: number,
  useAccidentals: boolean,
  random: Random,
): Spelling[] {
  const low = staffStep(level.lowest);
  const high = staffStep(level.highest);
  const inRange = (step: number) => step >= low && step <= high;
  const stepsInRange = Array.from({ length: high - low + 1 }, (_, i) => low + i);

  const startOptions = stepsInRange.filter((s) =>
    TONIC_TRIAD_LETTERS.has(naturalFromStaffStep(s).letter),
  );
  const tonics = stepsInRange.filter((s) => naturalFromStaffStep(s).letter === "C");

  const steps: number[] = [pickUniform(startOptions, random)];
  for (let i = 1; i < count - 1; i++) {
    const previous = steps[i - 1];
    const options = INTERVAL_WEIGHTS.filter(([interval]) => inRange(previous + interval));
    steps.push(previous + pickWeighted(options, random));
  }
  if (count > 1) {
    const previous = steps[count - 2];
    steps.push(nearest(tonics, previous));
  } else {
    steps[0] = pickUniform(tonics, random);
  }

  const spellings = steps.map(naturalFromStaffStep);
  if (useAccidentals) addChromaticApproaches(spellings, steps, random);
  return spellings;
}

/**
 * Sharpen a note that steps up to the next one, or flatten one that steps
 * down, so accidentals lean into where the melody is going (F♯→G, B♭→A).
 * First and last notes stay diatonic to keep the phrase anchored in C.
 */
function addChromaticApproaches(spellings: Spelling[], steps: number[], random: Random): void {
  for (let i = 1; i < spellings.length - 1; i++) {
    if (random() >= ACCIDENTAL_PROBABILITY) continue;
    const { letter } = spellings[i];
    const motion = steps[i + 1] - steps[i];
    let alter: Alter = 0;
    if (motion === 1 && letter !== "E" && letter !== "B") alter = 1;
    if (motion === -1 && letter !== "F" && letter !== "C") alter = -1;
    spellings[i] = { ...spellings[i], alter };
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
