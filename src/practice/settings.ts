import { DEFAULT_KEY_ID } from "../music/keys";
import { DEFAULT_LEVEL_ID } from "../music/levels";
import type { AccidentalFrequency } from "../music/types";

export interface Settings {
  namesOnNotes: boolean;
  namesOnKeys: boolean;
  key: string;
  accidentalFrequency: AccidentalFrequency;
  bars: number;
  /** Id of a Level from LEVELS (note range). */
  range: string;
}

export const DEFAULT_SETTINGS: Settings = {
  namesOnNotes: false,
  namesOnKeys: false,
  key: DEFAULT_KEY_ID,
  accidentalFrequency: "none",
  bars: 2,
  range: DEFAULT_LEVEL_ID,
};
