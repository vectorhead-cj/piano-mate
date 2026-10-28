import type { Duration, RhythmFlavor } from "./types";

export interface RhythmCell {
  /** One bar of durations that sum to BEATS_PER_BAR. */
  pattern: readonly Duration[];
  weight: number;
}

export interface RhythmProfile {
  id: RhythmFlavor;
  label: string;
  /** Allowed note values for this flavor (union of its cells). */
  durations: readonly Duration[];
  cells: readonly RhythmCell[];
}

/** Beat length of each duration in quarter notes (eighth = ½). */
export const BEATS: Record<Duration, number> = { w: 4, h: 2, q: 1, "8": 0.5 };

export const BEATS_PER_BAR = 4;

function cell(pattern: readonly Duration[], weight: number): RhythmCell {
  return { pattern, weight };
}

/** Shared quarter/half/whole cells used by basic and eighths. */
const SIMPLE_CELLS: readonly RhythmCell[] = [
  cell(["q", "q", "q", "q"], 4),
  cell(["h", "h"], 3),
  cell(["q", "q", "h"], 3),
  cell(["h", "q", "q"], 3),
  cell(["q", "h", "q"], 2),
  cell(["w"], 1),
];

const EIGHTH_CELLS: readonly RhythmCell[] = [
  cell(["8", "8", "8", "8", "q", "q"], 3),
  cell(["q", "q", "8", "8", "8", "8"], 3),
  cell(["q", "8", "8", "8", "8", "q"], 3),
  cell(["8", "8", "q", "8", "8", "q"], 2),
  cell(["8", "8", "8", "8", "h"], 2),
  cell(["h", "8", "8", "8", "8"], 2),
  cell(["q", "8", "8", "h"], 2),
  cell(["8", "8", "q", "h"], 2),
  cell(["8", "8", "8", "8", "8", "8", "8", "8"], 1),
];

const BUSY_CELLS: readonly RhythmCell[] = [
  cell(["8", "8", "8", "8", "8", "8", "8", "8"], 4),
  cell(["8", "8", "8", "8", "q", "q"], 3),
  cell(["q", "q", "8", "8", "8", "8"], 3),
  cell(["q", "8", "8", "8", "8", "q"], 3),
  cell(["8", "8", "q", "8", "8", "q"], 3),
  cell(["8", "8", "8", "8", "h"], 2),
  cell(["h", "8", "8", "8", "8"], 2),
  cell(["q", "8", "8", "h"], 2),
  cell(["h", "q", "q"], 1),
  cell(["q", "q", "q", "q"], 1),
  cell(["h", "h"], 1),
];

export const RHYTHM_PROFILES: readonly RhythmProfile[] = [
  {
    id: "basic",
    label: "Basic",
    durations: ["w", "h", "q"],
    cells: SIMPLE_CELLS,
  },
  {
    id: "eighths",
    label: "Eighths",
    durations: ["w", "h", "q", "8"],
    cells: [...SIMPLE_CELLS, ...EIGHTH_CELLS],
  },
  {
    id: "busy",
    label: "Busy",
    durations: ["h", "q", "8"],
    cells: BUSY_CELLS,
  },
];

export const DEFAULT_RHYTHM_FLAVOR: RhythmFlavor = "basic";

export function rhythmById(id: RhythmFlavor): RhythmProfile {
  const found = RHYTHM_PROFILES.find((r) => r.id === id);
  if (!found) throw new Error(`Unknown rhythm flavor: ${id}`);
  return found;
}

/** Prefer cells that end on a long note (half/whole), else quarter, else any. */
export function cellsForBar(
  profile: RhythmProfile,
  isLastBar: boolean,
): readonly RhythmCell[] {
  if (!isLastBar) return profile.cells;
  const longEnd = profile.cells.filter((c) => BEATS[c.pattern[c.pattern.length - 1]] >= 2);
  if (longEnd.length > 0) return longEnd;
  const quarterEnd = profile.cells.filter((c) => BEATS[c.pattern[c.pattern.length - 1]] >= 1);
  return quarterEnd.length > 0 ? quarterEnd : profile.cells;
}
