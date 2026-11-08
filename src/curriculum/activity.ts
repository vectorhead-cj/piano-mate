import { playedMs, type PracticeEvent } from "./events";

/** One local calendar day of practice. */
export interface DayActivity {
  /** Epoch ms of the day's local midnight. */
  day: number;
  /** Minutes of phrases played. */
  minutes: number;
  /** Minutes on flashcards. */
  cardMinutes: number;
  /** Minutes on imported pieces. */
  pieceMinutes: number;
}

/** A card left open counts for no longer than this. */
export const CARD_MAX_MS = 60_000;

/** A piece pass counts for no longer than this, so one left waiting doesn't fill the day. */
export const PASS_MAX_MS = 10 * 60_000;

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Minutes played on each of the last `days` local days, oldest first, ending today. Every
 * phrase counts, curriculum or custom, on whatever input; each falls on the day it finished.
 * Flashcards are counted apart: from when a card came up to its answer, at most CARD_MAX_MS.
 * So are piece passes: from the count-in to the grading, at most PASS_MAX_MS.
 */
export function dailyMinutes(events: readonly PracticeEvent[], days: number, now = Date.now()): DayActivity[] {
  const totals = new Map<string, number>();
  const cardTotals = new Map<string, number>();
  const pieceTotals = new Map<string, number>();
  const add = (map: Map<string, number>, at: number, ms: number) => {
    const key = dayKey(new Date(at));
    map.set(key, (map.get(key) ?? 0) + ms);
  };
  for (const event of events) {
    if (event.type === "phrase-completed") add(totals, event.at, playedMs(event));
    else if (event.type === "card-answered") add(cardTotals, event.at, Math.min(CARD_MAX_MS, Math.max(0, event.at - event.startedAt)));
    else if (event.type === "piece-pass") add(pieceTotals, event.at, Math.min(PASS_MAX_MS, Math.max(0, event.at - event.startedAt)));
  }
  const today = new Date(now);
  return Array.from({ length: days }, (_, i) => {
    // Stepping by calendar date, not 24 h, keeps days whole across clock changes.
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i));
    return {
      day: date.getTime(),
      minutes: (totals.get(dayKey(date)) ?? 0) / 60_000,
      cardMinutes: (cardTotals.get(dayKey(date)) ?? 0) / 60_000,
      pieceMinutes: (pieceTotals.get(dayKey(date)) ?? 0) / 60_000,
    };
  });
}
