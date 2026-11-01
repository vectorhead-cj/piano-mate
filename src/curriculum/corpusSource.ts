import { generateExercise, type Random } from "../music/generator";
import { phraseInKey, type CorpusPhrase } from "../music/corpus";
import { keyAlter, keyById, MINOR_KEYS, type KeyMode } from "../music/keys";
import { levelById } from "../music/levels";
import { allowedDurations, usesOnly, type Notation } from "../music/notation";
import { midiOf, naturalFromStaffStep, staffStep } from "../music/pitch";
import type { AccidentalFrequency, Clef, Exercise, RhythmFlavor } from "../music/types";
import type { Settings } from "../practice/settings";
import { MIX_SHARE, stageNotations, type Stage } from "./curriculum";
import { spanLevel, spanMidiRange, type SpanId } from "./spans";

/** A stage with fewer real phrases than this uses generated ones instead. */
export const MIN_STAGE_POOL = 50;

/** Custom practice settles for fewer, since the player picked the combination. */
export const MIN_CUSTOM_POOL = 10;

/**
 * Which of a phrase's narrowest range windows belong to each span, so a stage gets
 * phrases that need its range rather than ones that would fit a smaller stage.
 */
const SPAN_WINDOWS: Record<SpanId, readonly string[]> = {
  five: ["five"],
  octave: ["sixth", "authentic", "plagal"],
  twelfth: ["dominant-octave", "tonic-twelfth"],
  "two-octaves": ["dominant-twelfth", "two-octaves"],
};

const RHYTHM_ORDER: readonly RhythmFlavor[] = ["basic", "eighths", "busy"];

/** Phrases from lower rhythm levels make up at most this share of a stage's own, for variety. */
const LOWER_RHYTHM_SHARE = 0.25;

/** Notes outside the key signature for each accidental setting: none, one, two, three or more. */
export function matchesAccidentals(chromatic: number, frequency: AccidentalFrequency): boolean {
  switch (frequency) {
    case "none":
      return chromatic === 0;
    case "rare":
      return chromatic === 1;
    case "medium":
      return chromatic === 2;
    case "common":
      return chromatic >= 3;
  }
}

/**
 * At least this share of a stage's phrases use the notation it introduces, when its pool has
 * fewer of them, so the new thing gets practised.
 */
export const FEATURED_SHARE = 0.5;

function shuffled<T>(items: readonly T[], random: Random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Phrases of one mode for a stage: its own rhythm level plus a few from lower levels, using
 * only notation the curriculum has introduced by this stage.
 */
export function stagePool(
  corpus: readonly CorpusPhrase[],
  clef: Clef,
  stage: Stage,
  mode: KeyMode,
  random: Random = Math.random,
): CorpusPhrase[] {
  const level = RHYTHM_ORDER.indexOf(stage.rhythm);
  const notations = stageNotations(stage);
  const base = corpus.filter(
    (p) =>
      p.clef === clef &&
      p.mode === mode &&
      p.bars === stage.bars &&
      SPAN_WINDOWS[stage.span].includes(p.window) &&
      matchesAccidentals(p.chromatic, stage.accidentals) &&
      usesOnly(p.notations, notations),
  );
  const own = base.filter((p) => p.rhythm === stage.rhythm);
  const lower = base.filter((p) => RHYTHM_ORDER.indexOf(p.rhythm) < level);
  return [...own, ...shuffled(lower, random).slice(0, Math.floor(own.length * LOWER_RHYTHM_SHARE))];
}

/** Each mode's pool, or empty when it has too few phrases to deal from. */
function stagePools(corpus: readonly CorpusPhrase[] | null, clef: Clef, stage: Stage, random: Random): Record<KeyMode, CorpusPhrase[]> {
  const pool = (mode: KeyMode) => {
    const phrases = corpus ? stagePool(corpus, clef, stage, mode, random) : [];
    return phrases.length >= MIN_STAGE_POOL ? phrases : [];
  };
  return { major: pool("major"), minor: pool("minor") };
}

/** "Essen folk songs" from "Essen folk songs: Ich fahr dahin". */
function collectionOf(phrase: CorpusPhrase): string {
  return phrase.work.split(":")[0];
}

/**
 * Draws from a deck, so no phrase repeats until all have been drawn, at random but after
 * `last` from another collection when one is left, else from another work.
 */
function deck(pool: readonly CorpusPhrase[], random: Random): (last: CorpusPhrase | undefined) => CorpusPhrase {
  let left: CorpusPhrase[] = [];
  return (last) => {
    if (left.length === 0) left = [...pool];
    const unlike = (differs: (p: CorpusPhrase) => boolean) => {
      const found = last ? left.filter(differs) : left;
      return found.length > 0 ? found : null;
    };
    const choices =
      unlike((p) => collectionOf(p) !== collectionOf(last!)) ?? unlike((p) => p.work !== last!.work) ?? left;
    const phrase = choices[Math.floor(random() * choices.length)];
    left.splice(left.indexOf(phrase), 1);
    return phrase;
  };
}

/**
 * Deals phrases from a deck (see `deck`) in a key from `keys` (not the same one twice in a
 * row). Phrases using `featured` notation get their own deck when they'd otherwise make up
 * less than FEATURED_SHARE of the deals. `place` writes a phrase out in a key, or returns null
 * when it can't be.
 */
function dealer(
  pool: readonly CorpusPhrase[],
  keys: readonly string[],
  place: (phrase: CorpusPhrase, key: string) => Exercise | null,
  random: Random,
  featured: readonly Notation[] = [],
): () => Exercise | null {
  const uses = (p: CorpusPhrase) => featured.some((n) => p.notations.has(n));
  const special = pool.filter(uses);
  const split = special.length > 0 && special.length < pool.length * FEATURED_SHARE;
  const featuredDeck = split ? deck(special, random) : null;
  const mainDeck = deck(split ? pool.filter((p) => !uses(p)) : pool, random);
  let last: CorpusPhrase | undefined;
  let previousKey: string | undefined;
  return () => {
    for (let attempt = 0; attempt < pool.length; attempt++) {
      const phrase = (featuredDeck && random() < FEATURED_SHARE ? featuredDeck : mainDeck)(last);
      last = phrase;
      const choices = keys.length > 1 ? keys.filter((k) => k !== previousKey) : keys;
      const first = Math.floor(random() * choices.length);
      for (let i = 0; i < choices.length; i++) {
        const key = choices[(first + i) % choices.length];
        const exercise = place(phrase, key);
        if (exercise) {
          previousKey = key;
          return exercise;
        }
      }
    }
    return null;
  };
}

/** The tonic sits where the stage's span starts, so plagal phrases dip below it. */
export function stageTonicStep(clef: Clef, stage: Stage, key: string): number {
  return staffStep(spanLevel(clef, key, stage.span).lowest);
}

/**
 * Phrases for a stage in a key from its set (not the same one twice in a row): real phrases
 * of the key's mode, or generated ones when the stage has too few of that mode.
 */
export function stageSource(corpus: readonly CorpusPhrase[] | null, clef: Clef, stage: Stage, random: Random = Math.random): () => Exercise {
  const pools = stagePools(corpus, clef, stage, random);
  const durations = allowedDurations(stageNotations(stage));
  const deals = new Map<string, () => Exercise | null>();
  const real = (key: string) => {
    const pool = pools[keyById(key).mode];
    if (pool.length === 0) return null;
    if (!deals.has(key)) {
      const place = (phrase: CorpusPhrase) => phraseInKey(phrase, key, stageTonicStep(clef, stage, key));
      deals.set(key, dealer(pool, [key], place, random, stage.introduces));
    }
    return deals.get(key)!();
  };
  const generated = (key: string) =>
    generateExercise(spanLevel(clef, key, stage.span), { bars: stage.bars, key, accidentalFrequency: stage.accidentals, rhythm: stage.rhythm, durations }, random);
  let previousKey: string | undefined;
  return () => {
    const choices = stage.keys.length > 1 ? stage.keys.filter((k) => k !== previousKey) : stage.keys;
    const key = choices[Math.floor(random() * choices.length)];
    previousKey = key;
    return real(key) ?? generated(key);
  };
}

/** Keys to show for a stage: its span in every key, widened to every step its phrases reach. */
export function stageMidiRange(corpus: readonly CorpusPhrase[] | null, clef: Clef, stage: Stage): { lowest: number; highest: number } {
  const range = spanMidiRange(clef, stage.keys, stage.span);
  const pools = stagePools(corpus, clef, stage, () => 0);
  for (const keyId of stage.keys) {
    const key = keyById(keyId);
    const pool = pools[key.mode];
    if (pool.length === 0) continue;
    const low = Math.min(...pool.map((p) => p.low));
    const high = Math.max(...pool.map((p) => p.high));
    const tonic = stageTonicStep(clef, stage, keyId);
    const midi = (step: number) => {
      const natural = naturalFromStaffStep(tonic + step);
      return midiOf({ ...natural, alter: keyAlter(key, natural.letter) });
    };
    // One semitone either side for chromatic notes.
    range.lowest = Math.min(range.lowest, midi(low) - 1);
    range.highest = Math.max(range.highest, midi(high) + 1);
  }
  return range;
}

/**
 * Custom practice from real phrases matching the settings, inside the chosen range: major
 * phrases in the chosen key and minor ones in its relative minor (the settings bar offers
 * "C / Am" as one choice). Returns null (so practice generates a phrase) when settings ask for generated
 * phrases or too few real ones match.
 */
export function customSource(corpus: readonly CorpusPhrase[] | null, settings: () => Settings, random: Random = Math.random): () => Exercise | null {
  let cached: { signature: string; deal: (() => Exercise | null) | null } | null = null;
  return () => {
    const s = settings();
    if (!corpus || s.source !== "corpus") return null;
    const signature = JSON.stringify([s.range, s.key, s.rhythm, s.time, s.accidentalFrequency, s.bars]);
    if (cached?.signature !== signature) cached = { signature, deal: customDealer(corpus, s, random) };
    return cached.deal?.() ?? null;
  };
}

function customDealer(corpus: readonly CorpusPhrase[], s: Settings, random: Random): (() => Exercise | null) | null {
  const level = levelById(s.range);
  const bottom = staffStep(level.lowest);
  const top = staffStep(level.highest);
  const times = s.time === "4/4" ? ["4/4", "2/2"] : [s.time];
  const major = keyById(s.key);
  const keys: Record<KeyMode, string> = {
    major: major.id,
    minor: MINOR_KEYS.find((k) => k.signature === major.signature)!.id,
  };
  // The lowest tonic that keeps the phrase's lowest note in range, if the rest fits too.
  const tonicStep = (phrase: CorpusPhrase): number | null => {
    const tonic = staffStep({ letter: keyById(keys[phrase.mode]).tonic, alter: 0, octave: 0 });
    const step = tonic + Math.ceil((bottom - phrase.low - tonic) / 7) * 7;
    return step + phrase.high <= top ? step : null;
  };
  const base = corpus.filter(
    (p) =>
      p.clef === level.clef &&
      p.rhythm === s.rhythm &&
      times.includes(p.time) &&
      matchesAccidentals(p.chromatic, s.accidentalFrequency) &&
      tonicStep(p) !== null,
  );
  const pool = base.filter((p) => p.bars === s.bars);
  if (pool.length < MIN_CUSTOM_POOL) return null;
  return dealer(pool, [s.key], (phrase) => phraseInKey(phrase, keys[phrase.mode], tonicStep(phrase)!), random);
}

/**
 * A mixing tier's phrases: about MIX_SHARE from the stage's own source, the rest from its
 * reviews' sources, picked by weight. With no reviews, every phrase is the stage's own.
 */
export function mixedSource(
  own: () => Exercise,
  reviews: readonly { source: () => Exercise; weight: number }[],
  random: Random = Math.random,
): () => Exercise {
  const total = reviews.reduce((sum, r) => sum + r.weight, 0);
  return () => {
    if (reviews.length === 0 || random() < MIX_SHARE) return own();
    let pick = random() * total;
    for (const review of reviews) {
      pick -= review.weight;
      if (pick < 0) return review.source();
    }
    return reviews[reviews.length - 1].source();
  };
}
