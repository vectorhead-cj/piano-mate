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
  /** The stage can be practised (the first stage, or the previous one has ★★). */
  unlocked: boolean;
  /** Read is open on an unlocked stage; each later tier needs the star before it. */
  tierOpen: Record<Tier, boolean>;
}

export interface TrackProgress {
  stages: Record<string, StageProgress>;
  /** Stages with ★★ (the ones that opened their successor). */
  passed: number;
  completed: number;
  /** The furthest unlocked stage without ★★, or the last stage once all are passed. */
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

  const ordered = [...events].sort((a, b) => a.at - b.at);
  for (const event of ordered) {
    if (event.context.kind !== "curriculum" || !countsForProgress(event)) continue;
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
    CLEF_TRACKS.map((clef) => [clef, trackProgress(clef, tiersFor)]),
  ) as Progress;
}

function trackProgress(
  clef: Clef,
  tiersFor: (clef: Clef, stageId: string) => Record<Tier, TierProgress>,
): TrackProgress {
  const stages: Record<string, StageProgress> = {};
  let previousPassed: boolean = true;
  let passed = 0;
  let completed = 0;
  let currentStageId = PLACED_STAGES[PLACED_STAGES.length - 1].stage.id;
  let currentFound = false;

  for (const { stage } of PLACED_STAGES) {
    const tiers = tiersFor(clef, stage.id);
    const unlocked: boolean = previousPassed;
    let stars = 0;
    for (const tier of TIERS) {
      if (tiers[tier].best < STAR_STREAK) break;
      stars++;
    }
    const complete = stars >= 2 && Math.max(tiers.play.best, tiers.fluent.best) >= COMPLETE_STREAK;
    const tierOpen = { read: unlocked, play: unlocked && stars >= 1, fluent: unlocked && stars >= 2 };
    stages[stage.id] = { tiers, stars, complete, unlocked, tierOpen };

    if (stars >= 2) passed++;
    if (complete) completed++;
    if (unlocked && stars < 2 && !currentFound) {
      currentStageId = stage.id;
      currentFound = true;
    }
    previousPassed = unlocked && stars >= 2;
  }

  return { stages, passed, completed, currentStageId };
}

/** What a newly recorded phrase changed, for the after-phrase message. */
export interface Milestone {
  kind: "star" | "complete";
  stars: number;
  /** The stage this star opened, if any. */
  openedStageId?: string;
}

export function milestoneBetween(before: Progress, after: Progress, clef: Clef, stageId: string): Milestone | undefined {
  const was = before[clef].stages[stageId];
  const now = after[clef].stages[stageId];
  if (!was || !now) return undefined;
  if (now.stars > was.stars) {
    const next = PLACED_STAGES[PLACED_STAGES.findIndex((p) => p.stage.id === stageId) + 1];
    const opened = next && !before[clef].stages[next.stage.id].unlocked && after[clef].stages[next.stage.id].unlocked;
    return { kind: "star", stars: now.stars, openedStageId: opened ? next.stage.id : undefined };
  }
  if (now.complete && !was.complete) return { kind: "complete", stars: now.stars };
  return undefined;
}
