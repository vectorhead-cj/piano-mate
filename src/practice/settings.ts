import { DEFAULT_KEY_ID } from "../music/keys";
import { DEFAULT_LEVEL_ID } from "../music/levels";
import { DEFAULT_RHYTHM_FLAVOR } from "../music/rhythms";
import type { AccidentalFrequency, RhythmFlavor } from "../music/types";

export type PracticeMode = "wait" | "rhythm";

export interface Settings {
  namesOnNotes: boolean;
  mode: PracticeMode;
  tempo: number;
  key: string;
  accidentalFrequency: AccidentalFrequency;
  rhythm: RhythmFlavor;
  bars: number;
  /** Id of a Level from LEVELS (note range). */
  range: string;
}

export const TEMPO_OPTIONS = [40, 50, 60, 72, 80, 96, 100, 120] as const;

export const DEFAULT_TEMPO = 60;

export const PRACTICE_MODE_LABELS: Record<PracticeMode, string> = {
  wait: "Wait",
  rhythm: "Rhythm",
};

export const DEFAULT_SETTINGS: Settings = {
  namesOnNotes: false,
  mode: "wait",
  tempo: DEFAULT_TEMPO,
  key: DEFAULT_KEY_ID,
  accidentalFrequency: "none",
  rhythm: DEFAULT_RHYTHM_FLAVOR,
  bars: 2,
  range: DEFAULT_LEVEL_ID,
};
