import type { Duration, RhythmFlavor, TimeSignature } from "./types";

export interface RhythmCell {
  /** One bar of durations that sum to the bar's length in quarter beats. */
  pattern: readonly Duration[];
  weight: number;
}

/** The time signatures the generator writes; 2/2 only comes from real music. */
export type GeneratedTime = "4/4" | "3/4";

export const GENERATED_TIMES: readonly GeneratedTime[] = ["4/4", "3/4"];

export interface RhythmProfile {
  id: RhythmFlavor;
  label: string;
  /** Allowed note values for this flavor (union of its cells). */
  durations: readonly Duration[];
  cells: Record<GeneratedTime, readonly RhythmCell[]>;
}

/** Beat length of each duration in quarter notes (eighth = ½). */
export const BEATS: Record<Duration, number> = { w: 4, "h.": 3, h: 2, "q.": 1.5, q: 1, "8": 0.5 };

const TIME_PARTS: Record<TimeSignature, { beats: number; beatType: number }> = {
  "4/4": { beats: 4, beatType: 4 },
  "3/4": { beats: 3, beatType: 4 },
  "2/2": { beats: 2, beatType: 2 },
};

/** Numerator and denominator as printed. */
export function timeParts(time: TimeSignature): { beats: number; beatType: number } {
  return TIME_PARTS[time];
}

/** Length of a full bar in quarter beats (2/2 and 4/4 are both 4). */
export function barBeats(time: TimeSignature): number {
  const { beats, beatType } = TIME_PARTS[time];
  return (beats * 4) / beatType;
}

export const DEFAULT_TIME: GeneratedTime = "4/4";

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
  cell(["h.", "q"], 2),
  cell(["q", "h."], 1),
  cell(["w"], 1),
];

const SIMPLE_CELLS_3: readonly RhythmCell[] = [
  cell(["q", "q", "q"], 4),
  cell(["h", "q"], 3),
  cell(["q", "h"], 2),
  cell(["h."], 1),
];

/** Eighths and dotted quarters (a dotted quarter always pairs with an eighth). */
const EIGHTH_CELLS: readonly RhythmCell[] = [
  cell(["8", "8", "8", "8", "q", "q"], 3),
  cell(["q", "q", "8", "8", "8", "8"], 3),
  cell(["q", "8", "8", "8", "8", "q"], 3),
  cell(["8", "8", "q", "8", "8", "q"], 2),
  cell(["8", "8", "8", "8", "h"], 2),
  cell(["h", "8", "8", "8", "8"], 2),
  cell(["q", "8", "8", "h"], 2),
  cell(["8", "8", "q", "h"], 2),
  cell(["q.", "8", "q", "q"], 3),
  cell(["q.", "8", "h"], 2),
  cell(["q", "q", "q.", "8"], 1),
  cell(["8", "8", "8", "8", "8", "8", "8", "8"], 1),
];

const EIGHTH_CELLS_3: readonly RhythmCell[] = [
  cell(["8", "8", "q", "q"], 3),
  cell(["q", "8", "8", "q"], 3),
  cell(["q", "q", "8", "8"], 2),
  cell(["q.", "8", "q"], 3),
  cell(["8", "8", "h"], 2),
  cell(["8", "8", "8", "8", "q"], 2),
  cell(["q", "8", "8", "8", "8"], 1),
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
  cell(["q.", "8", "8", "8", "q"], 2),
  cell(["8", "8", "q.", "8", "q"], 1),
  cell(["h", "q", "q"], 1),
  cell(["q", "q", "q", "q"], 1),
  cell(["h", "h"], 1),
];

const BUSY_CELLS_3: readonly RhythmCell[] = [
  cell(["8", "8", "8", "8", "8", "8"], 4),
  cell(["8", "8", "8", "8", "q"], 3),
  cell(["q", "8", "8", "8", "8"], 3),
  cell(["8", "8", "q", "8", "8"], 2),
  cell(["q.", "8", "8", "8"], 2),
  cell(["h", "q"], 1),
  cell(["q", "q", "q"], 1),
];

export const RHYTHM_PROFILES: readonly RhythmProfile[] = [
  {
    id: "basic",
    label: "Basic",
    durations: ["w", "h.", "h", "q"],
    cells: { "4/4": SIMPLE_CELLS, "3/4": SIMPLE_CELLS_3 },
  },
  {
    id: "eighths",
    label: "Eighths",
    durations: ["w", "h.", "h", "q.", "q", "8"],
    cells: { "4/4": [...SIMPLE_CELLS, ...EIGHTH_CELLS], "3/4": [...SIMPLE_CELLS_3, ...EIGHTH_CELLS_3] },
  },
  {
    id: "busy",
    label: "Busy",
    durations: ["h", "q.", "q", "8"],
    cells: { "4/4": BUSY_CELLS, "3/4": BUSY_CELLS_3 },
  },
];

export const DEFAULT_RHYTHM_FLAVOR: RhythmFlavor = "basic";

export function rhythmById(id: RhythmFlavor): RhythmProfile {
  const found = RHYTHM_PROFILES.find((r) => r.id === id);
  if (!found) throw new Error(`Unknown rhythm flavor: ${id}`);
  return found;
}

/** Prefer cells that end on a long note (half or longer), else quarter, else any. */
export function cellsForBar(
  profile: RhythmProfile,
  time: GeneratedTime,
  isLastBar: boolean,
): readonly RhythmCell[] {
  const cells = profile.cells[time];
  if (!isLastBar) return cells;
  const longEnd = cells.filter((c) => BEATS[c.pattern[c.pattern.length - 1]] >= 2);
  if (longEnd.length > 0) return longEnd;
  const quarterEnd = cells.filter((c) => BEATS[c.pattern[c.pattern.length - 1]] >= 1);
  return quarterEnd.length > 0 ? quarterEnd : cells;
}
