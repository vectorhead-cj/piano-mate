import { HAND_LABELS, type HandChoice } from "./piece";
import type { PiecePass } from "../curriculum/events";

/** "Slow first" earns each hand at the slow tempo before the standard one; "standard" goes straight there. */
export type Plan = "slow-first" | "standard";
export type Speed = "slow" | "standard";

export interface Step {
  hand: HandChoice;
  speed: Speed;
}

/** How a piece is learned; set per piece on its page. */
export interface PieceSettings {
  plan: Plan;
  /** Passes a step's streak counts. */
  streak: number;
  /** Passes in the streak that may fail. */
  misses: number;
  /** Onsets (a note or a chord) in a pass that may go wrong and still let it count. */
  slips: number;
  /** The standard tempo, quarter beats per minute: the file's own until changed. */
  tempo: number;
  /** The slow tempo, quarter beats per minute: what "slow" means for this piece. */
  slowTempo: number;
  /** The synth plays the hand not being practised. */
  otherHand: boolean;
  /** Clicks through each pass, not just the count-in. */
  metronome: boolean;
  /** The score's fingering numbers are drawn. */
  fingerings: boolean;
  /** Keys played in free play light the staff, yellow in the key's scale and red outside it. */
  highlightPlayed: boolean;
}

export const DEFAULT_TEMPO = 80;
export const MIN_TEMPO = 20;
export const MAX_TEMPO = 240;
/** The slow tempo a piece starts with, as a share of its standard one. */
const DEFAULT_SLOW_SHARE = 0.6;

export function defaultSettings(tempo = DEFAULT_TEMPO): PieceSettings {
  return { plan: "slow-first", streak: 10, misses: 1, slips: 1, tempo: Math.round(tempo), slowTempo: slowTempoFor(tempo), otherHand: true, metronome: true, fingerings: true, highlightPlayed: false };
}

function slowTempoFor(tempo: number, share = DEFAULT_SLOW_SHARE): number {
  return Math.max(MIN_TEMPO, Math.round(tempo * share));
}

/**
 * Settings as stored, which may predate later fields: missing ones take their defaults, and a
 * slow tempo kept as a share of the standard one (`slowShare`) becomes a tempo of its own.
 */
export function normalizeSettings(stored: Partial<PieceSettings> & { slowShare?: number }): PieceSettings {
  const { slowShare, ...rest } = stored;
  const base = defaultSettings(rest.tempo);
  const slowTempo = rest.slowTempo ?? (slowShare !== undefined ? slowTempoFor(base.tempo, slowShare) : base.slowTempo);
  return { ...base, ...rest, slowTempo };
}

export const PLAN_LABELS: Record<Plan, string> = { "slow-first": "Slow first, then standard", standard: "Standard tempo directly" };

/** Each phrase is learned hands apart before together: left, right, then both. */
export const HAND_ORDER: readonly HandChoice[] = ["left", "right", "both"];

export function stepsFor(plan: Plan): Step[] {
  const speeds: Speed[] = plan === "slow-first" ? ["slow", "standard"] : ["standard"];
  return HAND_ORDER.flatMap((hand) => speeds.map((speed) => ({ hand, speed })));
}

export function stepKey(step: Step): string {
  return `${step.hand}-${step.speed}`;
}

export function stepLabel(step: Step, plan: Plan): string {
  return plan === "slow-first" ? `${HAND_LABELS[step.hand]} · ${step.speed}` : HAND_LABELS[step.hand];
}

export function stepTempo(settings: PieceSettings, speed: Speed): number {
  return speed === "slow" ? Math.max(MIN_TEMPO, Math.round(settings.slowTempo)) : settings.tempo;
}

/** A phrase: written bars from..to, measure indices inclusive. */
export interface Phrase {
  from: number;
  to: number;
}

/** Phrases from the bars that start them; the first bar always starts one. */
export function phrasesOf(starts: readonly number[], measureCount: number): Phrase[] {
  const sorted = [...new Set([0, ...starts.filter((s) => s > 0 && s < measureCount)])].sort((a, b) => a - b);
  return sorted.map((from, i) => ({ from, to: (sorted[i + 1] ?? measureCount) - 1 }));
}

/** Progress is kept by the bars a phrase spans, so changing other phrases leaves it be. */
export function phraseKey(phrase: Phrase): string {
  return `${phrase.from}-${phrase.to}`;
}

export interface StepProgress {
  /** Whether each recent pass was clean, oldest first. */
  recent: boolean[];
  attempts: number;
  /** Epoch ms the step was first passed; it stays passed. */
  passedAt?: number;
}

/** Passes kept per step: enough for any streak length the settings offer. */
const KEPT = 30;

export const STREAK_CHOICES = [3, 5, 10, 15, 20] as const;
export const MISS_CHOICES = [0, 1, 2, 3] as const;
export const SLIP_CHOICES = [0, 1, 2] as const;

/** The full piece is its last stage: both hands at the standard tempo, played through clean once. */
export const FULL_STREAK = 1;

/** Whether the latest passes make a streak: `streak` of them with at most `misses` wrong. */
export function streakMet(recent: readonly boolean[], streak: number, misses: number): boolean {
  const window = recent.slice(-streak);
  return window.length >= streak && window.filter((clean) => !clean).length <= misses;
}

export function recordPass(previous: StepProgress | undefined, clean: boolean, streak: number, misses: number, now: number): StepProgress {
  const recent = [...(previous?.recent ?? []), clean].slice(-KEPT);
  const passedAt = previous?.passedAt ?? (streakMet(recent, streak, misses) ? now : undefined);
  return { recent, attempts: (previous?.attempts ?? 0) + 1, ...(passedAt !== undefined && { passedAt }) };
}

/** The streak row: one dot per pass it counts, the latest at the end. */
export function streakMarks(progress: StepProgress | undefined, streak: number): ("pending" | "correct" | "wrong")[] {
  const recent = (progress?.recent ?? []).slice(-streak);
  return Array.from({ length: streak }, (_, i) => (i >= recent.length ? "pending" : recent[i] ? "correct" : "wrong"));
}

export interface PieceProgress {
  /** By phrase key, then step key. */
  phrases: Record<string, Record<string, StepProgress>>;
  full?: StepProgress;
}

export function stepProgress(progress: PieceProgress, phrase: Phrase, step: Step): StepProgress | undefined {
  return progress.phrases[phraseKey(phrase)]?.[stepKey(step)];
}

export function withStep(progress: PieceProgress, phrase: Phrase, step: Step, value: StepProgress): PieceProgress {
  const key = phraseKey(phrase);
  return { ...progress, phrases: { ...progress.phrases, [key]: { ...progress.phrases[key], [stepKey(step)]: value } } };
}

/** Where to practise: a phrase and step, or the full piece. */
export type Place = { kind: "phrase"; phrase: number; step: Step } | { kind: "full" };

/** The first step not yet passed, phrase by phrase; once every phrase is done, the full piece. */
export function nextPlace(progress: PieceProgress, phrases: readonly Phrase[], plan: Plan, after?: Place): Place {
  const steps = stepsFor(plan);
  const start = after?.kind === "phrase" ? after.phrase : 0;
  for (let p = start; p < phrases.length; p++) {
    const step = steps.find((s) => !stepProgress(progress, phrases[p], s)?.passedAt);
    if (step) return { kind: "phrase", phrase: p, step };
  }
  // Earlier phrases still open come before the full piece.
  for (let p = 0; p < start; p++) {
    const step = steps.find((s) => !stepProgress(progress, phrases[p], s)?.passedAt);
    if (step) return { kind: "phrase", phrase: p, step };
  }
  return { kind: "full" };
}

/** Steps passed out of all of them, the full piece counting as one. */
export function pieceDone(progress: PieceProgress, phrases: readonly Phrase[], plan: Plan): { passed: number; total: number } {
  const steps = stepsFor(plan);
  const passed =
    phrases.reduce((sum, phrase) => sum + steps.filter((s) => stepProgress(progress, phrase, s)?.passedAt).length, 0) +
    (progress.full?.passedAt ? 1 : 0);
  return { passed, total: phrases.length * steps.length + 1 };
}

/** What a piece's passes add up to: its phrase steps and full piece, and its intro drills by feature id. */
export interface PiecePractice {
  progress: PieceProgress;
  intros: Record<string, StepProgress>;
}

/**
 * Folds a piece's passes into its progress, oldest first, each under the streak rule it was
 * played to. Progress is kept by the bars a phrase spans, so a phrase split later into the
 * same bars finds it again.
 */
export function projectPieceProgress(passes: readonly PiecePass[]): PiecePractice {
  let progress: PieceProgress = { phrases: {} };
  const intros: Record<string, StepProgress> = {};
  for (const pass of [...passes].sort((a, b) => a.at - b.at)) {
    const { place } = pass;
    const fold = (before: StepProgress | undefined) => recordPass(before, pass.clean, pass.streak, pass.misses, pass.at);
    if (place.kind === "intro") intros[place.feature] = fold(intros[place.feature]);
    else if (place.kind === "full") progress = { ...progress, full: fold(progress.full) };
    else {
      const phrase = { from: place.from, to: place.to };
      const step = { hand: place.hand, speed: place.speed };
      progress = withStep(progress, phrase, step, fold(stepProgress(progress, phrase, step)));
    }
  }
  return { progress, intros };
}
