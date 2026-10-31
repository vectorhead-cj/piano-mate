import { DEFAULT_KEY_ID } from "../music/keys";
import { DEFAULT_CLEF, DEFAULT_LEVEL_ID } from "../music/levels";
import { DEFAULT_RHYTHM_FLAVOR, DEFAULT_TIME, type GeneratedTime } from "../music/rhythms";
import type { AccidentalFrequency, Clef, RhythmFlavor } from "../music/types";

export type PracticeMode = "wait" | "rhythm";

export interface Settings {
  namesOnNotes: boolean;
  mode: PracticeMode;
  tempo: number;
  key: string;
  accidentalFrequency: AccidentalFrequency;
  rhythm: RhythmFlavor;
  time: GeneratedTime;
  bars: number;
  clef: Clef;
  /** Id of a Level from LEVELS (note range); always one of `clef`'s levels. */
  range: string;
}

export const TEMPO_OPTIONS = [40, 50, 60, 72, 80, 96, 100, 120] as const;

export const DEFAULT_TEMPO = 60;

export const DEFAULT_SETTINGS: Settings = {
  namesOnNotes: false,
  mode: "wait",
  tempo: DEFAULT_TEMPO,
  key: DEFAULT_KEY_ID,
  accidentalFrequency: "none",
  rhythm: DEFAULT_RHYTHM_FLAVOR,
  time: DEFAULT_TIME,
  bars: 2,
  clef: DEFAULT_CLEF,
  range: DEFAULT_LEVEL_ID,
};
