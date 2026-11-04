import { CLEF_TRACKS } from "../curriculum/curriculum";
import { cardOutcome, type CardAnswered, type PracticeEvent } from "../curriculum/events";
import type { Concept } from "./concepts";

/**
 * Spaced repetition after Anki's classic scheduler (SM-2), with the grades cut down to what a
 * flashcard that marks itself can say: right ("Good") or not ("Again"). A concept is tried a
 * few minutes apart until it sticks, then comes back after a day, and after that at intervals
 * that grow by its ease; a miss sends it back to the minutes and lowers its ease.
 *
 * Like progress, the schedule is never stored: it is folded from the card events, so these
 * rules can be retuned and old answers re-scheduled.
 */

/** Minutes between a new concept's first tries; passing the last one graduates it. */
export const LEARNING_STEPS_MIN: readonly number[] = [1, 10];
/** The same for a concept that was missed after graduating. */
export const RELEARNING_STEPS_MIN: readonly number[] = [10];
/** Days until a concept's first review once it has graduated. */
export const GRADUATING_DAYS = 1;
export const START_EASE = 2.5;
export const MIN_EASE = 1.3;
/** Ease lost to each miss in review. */
export const LAPSE_EASE = 0.2;
/** Share of the interval kept after a miss in review (Anki's "new interval"); at least a day is. */
export const LAPSE_INTERVAL_FACTOR = 0;
/** New concepts brought in per day, however many are unlocked. */
export const NEW_PER_DAY = 3;
/** With nothing else due, a try due within this long is brought forward rather than waited for. */
export const LEARN_AHEAD_MS = 20 * 60_000;
/** The day turns over at this hour, so a late-night session still belongs to the day before. */
export const ROLLOVER_HOUR = 4;

const MINUTE = 60_000;
const DAY = 86_400_000;

export type Phase = "learning" | "review" | "relearning";

/** Where a concept is in its schedule; a concept never answered has none. */
export interface Schedule {
  phase: Phase;
  /** Which learning step the next try is at (not used in review). */
  step: number;
  /** Days between reviews as last set; a relearning concept keeps the shortened one. */
  intervalDays: number;
  ease: number;
  /** Learning and relearning: epoch ms the next try is due. */
  dueAt: number;
  /** Review: the day (see dayNumber) it is due. */
  dueDay: number;
  lapses: number;
  /** Answers given. */
  reps: number;
  /** The day it was first answered, to count a day's new concepts. */
  introducedDay: number;
  lastAt: number;
}

/** The local calendar day an instant falls on, counted from 1970, turning over at ROLLOVER_HOUR. */
export function dayNumber(at: number): number {
  const date = new Date(at - ROLLOVER_HOUR * 60 * MINUTE);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
}

/** Epoch ms a day (see dayNumber) begins. */
export function dayStart(day: number): number {
  const date = new Date(day * DAY);
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), ROLLOVER_HOUR).getTime();
}

/** One more answer on a concept: what its schedule becomes. */
export function answer(previous: Schedule | undefined, passed: boolean, at: number): Schedule {
  const today = dayNumber(at);
  const base: Schedule = previous ?? {
    phase: "learning",
    step: 0,
    intervalDays: 0,
    ease: START_EASE,
    dueAt: at,
    dueDay: today,
    lapses: 0,
    reps: 0,
    introducedDay: today,
    lastAt: at,
  };
  const next = { ...base, reps: base.reps + 1, lastAt: at };
  switch (base.phase) {
    case "learning":
      // A new concept starts at its first step, so a first pass moves it on to the second.
      return learn(next, passed, LEARNING_STEPS_MIN, at, GRADUATING_DAYS);
    case "relearning":
      return learn(next, passed, RELEARNING_STEPS_MIN, at, base.intervalDays);
    case "review": {
      if (passed) {
        const intervalDays = Math.max(base.intervalDays + 1, Math.round(base.intervalDays * base.ease));
        return { ...next, intervalDays, dueDay: today + intervalDays };
      }
      return {
        ...next,
        phase: "relearning",
        step: 0,
        ease: Math.max(MIN_EASE, base.ease - LAPSE_EASE),
        intervalDays: Math.max(1, Math.floor(base.intervalDays * LAPSE_INTERVAL_FACTOR)),
        dueAt: at + RELEARNING_STEPS_MIN[0] * MINUTE,
        lapses: base.lapses + 1,
      };
    }
  }
}

/**
 * A try in learning or relearning. A pass moves to the next step, or graduates after the last
 * to review with `graduateDays`; a miss goes back to the first.
 */
function learn(state: Schedule, passed: boolean, steps: readonly number[], at: number, graduateDays: number): Schedule {
  if (!passed) return { ...state, step: 0, dueAt: at + steps[0] * MINUTE };
  const step = state.step + 1;
  if (step < steps.length) return { ...state, step, dueAt: at + steps[step] * MINUTE };
  return { ...state, phase: "review", step: 0, intervalDays: graduateDays, dueDay: dayNumber(at) + graduateDays };
}

/** Whether the card was a pass: every note right. "I don't know" and wrong both count against the concept. */
export function passed(event: CardAnswered): boolean {
  return cardOutcome(event) === "correct";
}

/** Each answered concept's schedule, folded from the log in the order the answers were given. */
export function scheduleConcepts(events: readonly PracticeEvent[]): Map<string, Schedule> {
  const schedules = new Map<string, Schedule>();
  const answers = events.filter((e): e is CardAnswered => e.type === "card-answered").sort((a, b) => a.at - b.at);
  for (const event of answers) schedules.set(event.concept, answer(schedules.get(event.concept), passed(event), event.at));
  return schedules;
}

export interface Queue {
  /** Tries due now, soonest first. */
  learning: Concept[];
  /** Reviews due today or overdue, most overdue first. */
  reviews: Concept[];
  /** Concepts not yet seen that today's quota still lets in, earliest in the curriculum first. */
  fresh: Concept[];
  /** Tries due within LEARN_AHEAD_MS, shown only when nothing else is. */
  ahead: Concept[];
  /** When something next comes due, if nothing is now (epoch ms). */
  nextAt: number | null;
}

/** What is up for practice at `now`, among the concepts unlocked. */
export function buildQueue(unlocked: readonly Concept[], schedules: ReadonlyMap<string, Schedule>, now: number): Queue {
  const today = dayNumber(now);
  const learning: Concept[] = [];
  const reviews: Concept[] = [];
  const fresh: Concept[] = [];
  const ahead: Concept[] = [];
  let nextAt: number | null = null;
  const soon = (at: number) => {
    nextAt = nextAt === null ? at : Math.min(nextAt, at);
  };

  for (const concept of unlocked) {
    const schedule = schedules.get(concept.id);
    if (!schedule) {
      fresh.push(concept);
    } else if (schedule.phase === "review") {
      if (schedule.dueDay <= today) reviews.push(concept);
      else soon(dayStart(schedule.dueDay));
    } else if (schedule.dueAt <= now) {
      learning.push(concept);
    } else {
      if (schedule.dueAt - now <= LEARN_AHEAD_MS) ahead.push(concept);
      soon(schedule.dueAt);
    }
  }

  const dueAt = (c: Concept) => schedules.get(c.id)!.dueAt;
  const dueDay = (c: Concept) => schedules.get(c.id)!.dueDay;
  const curriculumOrder = (a: Concept, b: Concept) => a.order - b.order || CLEF_TRACKS.indexOf(a.clef) - CLEF_TRACKS.indexOf(b.clef);
  learning.sort((a, b) => dueAt(a) - dueAt(b));
  ahead.sort((a, b) => dueAt(a) - dueAt(b));
  reviews.sort((a, b) => dueDay(a) - dueDay(b) || curriculumOrder(a, b));
  fresh.sort(curriculumOrder);

  let introducedToday = 0;
  for (const schedule of schedules.values()) if (schedule.introducedDay === today) introducedToday++;
  fresh.splice(Math.max(0, NEW_PER_DAY - introducedToday));
  return { learning, reviews, fresh, ahead, nextAt };
}

export interface NextCard {
  concept: Concept;
  kind: "learning" | "review" | "new";
}

/** The concept to test next: tries due first, then reviews, then new ones, then tries brought forward. */
export function nextCard(queue: Queue): NextCard | null {
  if (queue.learning.length > 0) return { concept: queue.learning[0], kind: "learning" };
  if (queue.reviews.length > 0) return { concept: queue.reviews[0], kind: "review" };
  if (queue.fresh.length > 0) return { concept: queue.fresh[0], kind: "new" };
  if (queue.ahead.length > 0) return { concept: queue.ahead[0], kind: "learning" };
  return null;
}

export interface DueCounts {
  new: number;
  learning: number;
  review: number;
  total: number;
}

/** The counts Anki shows: new, learning and review, as they stand. */
export function dueCounts(queue: Queue): DueCounts {
  const counts = { new: queue.fresh.length, learning: queue.learning.length + queue.ahead.length, review: queue.reviews.length };
  return { ...counts, total: counts.new + counts.learning + counts.review };
}

/** "in 10 min", "in 3 h", "tomorrow", "in 4 days": how long from `now` until `at`. */
export function whenText(now: number, at: number): string {
  const minutes = Math.max(1, Math.ceil((at - now) / MINUTE));
  if (minutes < 60) return `in ${minutes} min`;
  const days = dayNumber(at) - dayNumber(now);
  if (days <= 0) return `in ${Math.round(minutes / 60)} h`;
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

/** When a concept's next card is due: tries in minutes, reviews on a day. */
export function dueText(schedule: Schedule, now: number): string {
  if (schedule.phase === "review") {
    const days = schedule.dueDay - dayNumber(now);
    return days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  }
  return whenText(now, schedule.dueAt);
}
