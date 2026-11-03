import { playedMs, type PracticeEvent } from "./events";

/** One local calendar day of practice. */
export interface DayActivity {
  /** Epoch ms of the day's local midnight. */
  day: number;
  minutes: number;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Minutes played on each of the last `days` local days, oldest first, ending today. Every
 * phrase counts, curriculum or custom, on whatever input; each falls on the day it finished.
 */
export function dailyMinutes(events: readonly PracticeEvent[], days: number, now = Date.now()): DayActivity[] {
  const totals = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "phrase-completed") continue;
    const key = dayKey(new Date(event.at));
    totals.set(key, (totals.get(key) ?? 0) + playedMs(event));
  }
  const today = new Date(now);
  return Array.from({ length: days }, (_, i) => {
    // Stepping by calendar date, not 24 h, keeps days whole across clock changes.
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i));
    return { day: date.getTime(), minutes: (totals.get(dayKey(date)) ?? 0) / 60_000 };
  });
}
