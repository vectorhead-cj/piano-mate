import { DEFAULT_KEY_ID } from "../music/keys";
import type { AccidentalFrequency } from "../music/types";

export interface Settings {
  namesOnNotes: boolean;
  namesOnKeys: boolean;
  key: string;
  accidentalFrequency: AccidentalFrequency;
  bars: number;
}

export const DEFAULT_SETTINGS: Settings = {
  namesOnNotes: false,
  namesOnKeys: false,
  key: DEFAULT_KEY_ID,
  accidentalFrequency: "none",
  bars: 2,
};
