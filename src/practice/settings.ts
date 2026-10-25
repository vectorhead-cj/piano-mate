import type { NamingConvention } from "../music/types";

export interface Settings {
  namesOnNotes: boolean;
  namesOnKeys: boolean;
  convention: NamingConvention;
  accidentals: boolean;
  bars: number;
}

export const DEFAULT_SETTINGS: Settings = {
  namesOnNotes: false,
  namesOnKeys: false,
  convention: "english",
  accidentals: false,
  bars: 2,
};
