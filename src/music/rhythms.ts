import type { Duration, RhythmFlavor } from "./types";

export interface RhythmProfile {
  id: RhythmFlavor;
  label: string;
  /** Allowed note values for this flavor. */
  durations: readonly Duration[];
  /** Relative pick weights among allowed durations that fit the remaining beat. */
  weights: Readonly<Record<Duration, number>>;
}

/** Beat length of each duration in quarter notes (eighth = ½). */
export const BEATS: Record<Duration, number> = { w: 4, h: 2, q: 1, "8": 0.5 };

export const BEATS_PER_BAR = 4;

export const RHYTHM_PROFILES: readonly RhythmProfile[] = [
  {
    id: "basic",
    label: "Basic",
    durations: ["w", "h", "q"],
    weights: { w: 1, h: 3, q: 5, "8": 0 },
  },
  {
    id: "eighths",
    label: "Eighths",
    durations: ["w", "h", "q", "8"],
    weights: { w: 1, h: 3, q: 5, "8": 4 },
  },
  {
    id: "busy",
    label: "Busy",
    durations: ["h", "q", "8"],
    weights: { w: 0, h: 1, q: 4, "8": 6 },
  },
];

export const DEFAULT_RHYTHM_FLAVOR: RhythmFlavor = "basic";

export function rhythmById(id: RhythmFlavor): RhythmProfile {
  const found = RHYTHM_PROFILES.find((r) => r.id === id);
  if (!found) throw new Error(`Unknown rhythm flavor: ${id}`);
  return found;
}
