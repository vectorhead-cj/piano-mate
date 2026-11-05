import type { Clef } from "../music/types";
import {
  advanceStars,
  CLEF_TRACKS,
  hasIntro,
  MASTERY_ROUNDS,
  maxStars,
  MISS_WINDOW,
  PLACED_STAGES,
  placedStage,
  STAR_HITS,
  STAR_STREAK,
  stageVersionMatches,
  stageTiers,
  TIERS,
  type Tier,
} from "./curriculum";
import { countsForProgress, isPerfect, type PracticeEvent } from "./events";

/** MIDI phrases in a row up to now, with at most one miss in any MISS_WINDOW of them. */
export interface Streak {
  streak: number;
  /** Phrases played since the streak's latest miss; null while it has none. */
  sinceMiss: number | null;
}

/** Clean phrases out of the last MISS_WINDOW: the plain count the player sees. */
export function recentHits(recent: readonly boolean[]): number {
  return recent.filter(Boolean).length;
}

/** One more phrase on a streak. A second miss inside a window restarts it just after the first. */
export function extendStreak({ streak, sinceMiss }: Streak, perfect: boolean): Streak {
  if (perfect) return { streak: streak + 1, sinceMiss: sinceMiss === null ? null : sinceMiss + 1 };
  if (sinceMiss !== null && sinceMiss < MISS_WINDOW - 1) return { streak: sinceMiss + 1, sinceMiss: 0 };
  return { streak: streak + 1, sinceMiss: 0 };
}

export interface TierProgress extends Streak {
  /** Whether each of the last MISS_WINDOW phrases was clean, oldest first. */
  recent: boolean[];
  /** Fluent only, once its star is earned: mastery rounds passed in a row, up to MASTERY_ROUNDS. */
  rounds: number;
  /** The mastery round under way: whether each phrase so far was clean. */
  round: boolean[];
  best: number;
  attempts: number;
  perfects: number;
  /** Epoch ms of the phrase that first brought `best` to STAR_STREAK. */
  starredAt?: number;
  /** Fluent only: epoch ms of the round that completed mastery. */
  masteredAt?: number;
}

export interface StageProgress {
  tiers: Record<Tier, TierProgress>;
  /** 0–4: ★ Read, ★★ Play, ★★★ Mix, ★★★★ Fluent, each earned in order (0–3 without Mix). */
  stars: number;
  /** Epoch ms each earned star was earned, in order: a star counts once every star before it has. */
  starredAt: number[];
  /** Every star and MASTERY_ROUNDS clean rounds at Fluent. */
  mastered: boolean;
  /** When the stage was mastered, once it is. */
  masteredAt?: number;
  /**
   * The stage has new notation, and its intro (a row of its own before the stage) can be
   * watched: the previous stage has ★★★, or this is the first stage.
   */
  introOpen: boolean;
  /**
   * Its intro has been watched or skipped, in either track, or the stage has been practised
   * in this one; false when it has none.
   */
  introDone: boolean;
  /** The stage can be practised: the previous stage has ★★★ and its intro, if any, is done. */
  unlocked: boolean;
  /** Read is open on an unlocked stage; each later tier needs the star before it. */
  tierOpen: Record<Tier, boolean>;
}

export interface TrackProgress {
  stages: Record<string, StageProgress>;
  /** Stages with ★★★ (the ones that opened their successor). */
  passed: number;
  mastered: number;
  /**
   * The furthest unlocked stage without ★★★ (or the stage whose intro is next), or the last
   * stage once all are passed.
   */
  currentStageId: string;
}

export type Progress = Record<Clef, TrackProgress>;

function emptyTier(): TierProgress {
  return { streak: 0, sinceMiss: null, recent: [], rounds: 0, round: [], best: 0, attempts: 0, perfects: 0 };
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
      tiers = { read: emptyTier(), play: emptyTier(), mix: emptyTier(), fluent: emptyTier() };
      tiersByTrack.set(key, tiers);
    }
    return tiers;
  };

  const seen = introsSeen(events);
  const ordered = [...events].sort((a, b) => a.at - b.at);
  const startOrder: Partial<Record<Clef, number>> = {};
  for (const event of ordered) {
    if (event.type === "track-started") {
      const order = PLACED_STAGES.findIndex((p) => p.stage.id === event.stageId);
      if (order >= 0) startOrder[event.clef] = order;
    }
  }
  for (const event of ordered) {
    if (event.type !== "phrase-completed" || event.context.kind !== "curriculum" || !countsForProgress(event)) continue;
    // Practice on an earlier definition of the stage doesn't count for the one it has now.
    if (!stageVersionMatches(event.context.stageId, event.context.stageVersion)) continue;
    const tier = tiersFor(event.context.clef, event.context.stageId)[event.context.tier];
    if (!tier) continue;
    tier.attempts++;
    const perfect = isPerfect(event);
    if (perfect) tier.perfects++;
    // Mastery counts from the phrase after Fluent's star, and stops once it's reached.
    if (event.context.tier === "fluent" && tier.best >= STAR_STREAK && tier.rounds < MASTERY_ROUNDS) {
      tier.round = [...tier.round, perfect];
      if (tier.round.length === MISS_WINDOW) {
        tier.rounds = recentHits(tier.round) >= STAR_HITS ? tier.rounds + 1 : 0;
        tier.round = [];
        if (tier.rounds === MASTERY_ROUNDS) tier.masteredAt = event.at;
      }
    }
    Object.assign(tier, extendStreak(tier, perfect));
    tier.recent = [...tier.recent, perfect].slice(-MISS_WINDOW);
    tier.best = Math.max(tier.best, tier.streak);
    if (tier.best >= STAR_STREAK) tier.starredAt ??= event.at;
  }

  return Object.fromEntries(
    CLEF_TRACKS.map((clef) => [clef, trackProgress(clef, tiersFor, seen, startOrder[clef] ?? 0)]),
  ) as Progress;
}

function trackProgress(
  clef: Clef,
  tiersFor: (clef: Clef, stageId: string) => Record<Tier, TierProgress>,
  seen: ReadonlySet<string>,
  /** Stages up to this one are open whatever their stars (see TrackStarted). */
  startOrder: number,
): TrackProgress {
  const stages: Record<string, StageProgress> = {};
  let previousPassed: boolean = true;
  let passed = 0;
  let mastered = 0;
  let currentStageId = PLACED_STAGES[PLACED_STAGES.length - 1].stage.id;
  let currentFound = false;

  for (const { stage, order } of PLACED_STAGES) {
    if (order <= startOrder) previousPassed = true;
    const tiers = tiersFor(clef, stage.id);
    const intro = hasIntro(stage);
    const introOpen = intro && previousPassed;
    // Practising a stage counts as knowing its intro, so stages played before it existed stay open.
    const practised = TIERS.some((t) => tiers[t].attempts > 0);
    const introDone = intro && (seen.has(stage.id) || practised);
    const unlocked: boolean = previousPassed && (!intro || introDone);
    let stars = 0;
    const starredAt: number[] = [];
    const ownTiers = stageTiers(stage);
    for (const tier of ownTiers) {
      if (tiers[tier].best < STAR_STREAK) break;
      stars++;
      starredAt.push(Math.max(tiers[tier].starredAt!, starredAt[starredAt.length - 1] ?? 0));
    }
    const isMastered = stars === maxStars(stage) && tiers.fluent.rounds >= MASTERY_ROUNDS;
    const masteredAt = isMastered ? Math.max(tiers.fluent.masteredAt!, starredAt[starredAt.length - 1]) : undefined;
    const tierOpen = Object.fromEntries(TIERS.map((tier) => [tier, unlocked && ownTiers.includes(tier) && stars >= ownTiers.indexOf(tier)])) as Record<Tier, boolean>;
    stages[stage.id] = { tiers, stars, starredAt, mastered: isMastered, masteredAt, introOpen, introDone, unlocked, tierOpen };

    const advance = advanceStars(stage);
    if (stars >= advance) passed++;
    if (isMastered) mastered++;
    // Stages skipped by starting further on aren't where the track continues.
    if ((unlocked || introOpen) && stars < advance && order >= startOrder && !currentFound) {
      currentStageId = stage.id;
      currentFound = true;
    }
    previousPassed = unlocked && stars >= advance;
  }

  return { stages, passed, mastered, currentStageId };
}

/** Debug: every stage, intro and tier open, with stars and streaks as earned. */
export function unlockAll(progress: Progress): Progress {
  return Object.fromEntries(
    CLEF_TRACKS.map((clef) => [
      clef,
      {
        ...progress[clef],
        stages: Object.fromEntries(
          Object.entries(progress[clef].stages).map(([id, stage]) => [
            id,
            {
              ...stage,
              introOpen: stage.introOpen || hasIntro(placedStage(id)!.stage),
              unlocked: true,
              tierOpen: { read: true, play: true, mix: true, fluent: true },
            },
          ]),
        ),
      },
    ]),
  ) as Progress;
}

/** Stages whose intro has been watched or skipped, in either track (notation is the same in both). */
export function introsSeen(events: readonly PracticeEvent[]): Set<string> {
  return new Set(
    events.flatMap((event) =>
      event.type === "intro-completed" && stageVersionMatches(event.stageId, event.stageVersion) ? [event.stageId] : [],
    ),
  );
}

/** What a newly recorded phrase changed, for the after-phrase message. */
export interface Milestone {
  kind: "star" | "mastered";
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
  if (now.mastered && !was.mastered) return { kind: "mastered", stars: now.stars };
  return undefined;
}
