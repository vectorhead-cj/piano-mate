import type { Clef } from "../music/types";
import {
  CLEF_TRACKS,
  COMPLETE_STREAK,
  PLACED_STAGES,
  STAR_STREAK,
  TIERS,
  type Tier,
} from "./curriculum";
import { countsForProgress, isPerfect, type PracticeEvent } from "./events";

export interface TierProgress {
  /** Perfect MIDI phrases in a row, up to now. */
  streak: number;
  best: number;
  attempts: number;
  perfects: number;
}

export interface StageProgress {
  tiers: Record<Tier, TierProgress>;
  /** 0–3: ★ Read, ★★ Play, ★★★ Fluent, each earned in order. */
  stars: number;
  complete: boolean;
  /**
   * The stage has new notation, and its intro (a row of its own before the stage) can be
   * watched: the previous stage has ★★, or this is the first stage.
   */
  introOpen: boolean;
  /** Its intro has been watched or skipped, in either track; false when it has none. */
  introDone: boolean;
  /** The stage can be practised: the previous stage has ★★ and its intro, if any, is done. */
  unlocked: boolean;
  /** Read is open on an unlocked stage; each later tier needs the star before it. */
  tierOpen: Record<Tier, boolean>;
}

export interface TrackProgress {
  stages: Record<string, StageProgress>;
  /** Stages with ★★ (the ones that opened their successor). */
  passed: number;
  completed: number;
  /**
   * The furthest unlocked stage without ★★ (or the stage whose intro is next), or the last
   * stage once all are passed.
   */
  currentStageId: string;
}

export type Progress = Record<Clef, TrackProgress>;

function emptyTier(): TierProgress {
  return { streak: 0, best: 0, attempts: 0, perfects: 0 };
}

/**
 * Folds the event log into progress. Only curriculum phrases played entirely on MIDI count;
 * a screen-keyboard phrase neither extends nor breaks a streak. Events for stages the
 * curriculum no longer has are ignored.
 */
export function projectProgress(events: readonly PracticeEvent[]): Progress {
  const tiersByTrack = new Map<string, Record<Tier, TierProgress>>();
  const tiersFor = (clef: Clef, stageId: string) => {
    const key = `${clef}/${stageId}`;
    let tiers = tiersByTrack.get(key);
    if (!tiers) {
      tiers = { read: emptyTier(), play: emptyTier(), fluent: emptyTier() };
      tiersByTrack.set(key, tiers);
    }
    return tiers;
  };

  const seen = introsSeen(events);
  const ordered = [...events].sort((a, b) => a.at - b.at);
  for (const event of ordered) {
    if (event.type !== "phrase-completed" || event.context.kind !== "curriculum" || !countsForProgress(event)) continue;
    const tier = tiersFor(event.context.clef, event.context.stageId)[event.context.tier];
    if (!tier) continue;
    tier.attempts++;
    if (isPerfect(event)) {
      tier.perfects++;
      tier.streak++;
      tier.best = Math.max(tier.best, tier.streak);
    } else {
      tier.streak = 0;
    }
  }

  return Object.fromEntries(
    CLEF_TRACKS.map((clef) => [clef, trackProgress(clef, tiersFor, seen)]),
  ) as Progress;
}

function trackProgress(
  clef: Clef,
  tiersFor: (clef: Clef, stageId: string) => Record<Tier, TierProgress>,
  seen: ReadonlySet<string>,
): TrackProgress {
  const stages: Record<string, StageProgress> = {};
  let previousPassed: boolean = true;
  let passed = 0;
  let completed = 0;
  let currentStageId = PLACED_STAGES[PLACED_STAGES.length - 1].stage.id;
  let currentFound = false;

  for (const { stage } of PLACED_STAGES) {
    const tiers = tiersFor(clef, stage.id);
    const hasIntro = stage.introduces.length > 0;
    const introOpen = hasIntro && previousPassed;
    const introDone = hasIntro && seen.has(stage.id);
    const unlocked: boolean = previousPassed && (!hasIntro || introDone);
    let stars = 0;
    for (const tier of TIERS) {
      if (tiers[tier].best < STAR_STREAK) break;
      stars++;
    }
    const complete = stars >= 2 && Math.max(tiers.play.best, tiers.fluent.best) >= COMPLETE_STREAK;
    const tierOpen = { read: unlocked, play: unlocked && stars >= 1, fluent: unlocked && stars >= 2 };
    stages[stage.id] = { tiers, stars, complete, introOpen, introDone, unlocked, tierOpen };

    if (stars >= 2) passed++;
    if (complete) completed++;
    if ((unlocked || introOpen) && stars < 2 && !currentFound) {
      currentStageId = stage.id;
      currentFound = true;
    }
    previousPassed = unlocked && stars >= 2;
  }

  return { stages, passed, completed, currentStageId };
}

/** Stages whose intro has been watched or skipped, in either track (notation is the same in both). */
export function introsSeen(events: readonly PracticeEvent[]): Set<string> {
  return new Set(events.flatMap((event) => (event.type === "intro-completed" ? [event.stageId] : [])));
}

/** What a newly recorded phrase changed, for the after-phrase message. */
export interface Milestone {
  kind: "star" | "complete";
  stars: number;
  /** The stage this star opened, or whose intro it opened, if any. */
  openedStageId?: string;
  /** What opened is the stage's intro; the stage follows once it's done. */
  openedIntro?: boolean;
}

export function milestoneBetween(before: Progress, after: Progress, clef: Clef, stageId: string): Milestone | undefined {
  const was = before[clef].stages[stageId];
  const now = after[clef].stages[stageId];
  if (!was || !now) return undefined;
  if (now.stars > was.stars) {
    const next = PLACED_STAGES[PLACED_STAGES.findIndex((p) => p.stage.id === stageId) + 1];
    if (!next) return { kind: "star", stars: now.stars };
    const [nextBefore, nextAfter] = [before[clef].stages[next.stage.id], after[clef].stages[next.stage.id]];
    if (!nextBefore.unlocked && nextAfter.unlocked) return { kind: "star", stars: now.stars, openedStageId: next.stage.id };
    if (!nextBefore.introOpen && nextAfter.introOpen && !nextAfter.introDone) {
      return { kind: "star", stars: now.stars, openedStageId: next.stage.id, openedIntro: true };
    }
    return { kind: "star", stars: now.stars };
  }
  if (now.complete && !was.complete) return { kind: "complete", stars: now.stars };
  return undefined;
}
