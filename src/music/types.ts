export type Letter = "C" | "D" | "E" | "F" | "G" | "A" | "B";

/** -1 = flat, 0 = natural, 1 = sharp */
export type Alter = -1 | 0 | 1;

export interface Spelling {
  letter: Letter;
  alter: Alter;
  octave: number;
}

/** VexFlow duration codes: whole, half, quarter. */
export type Duration = "w" | "h" | "q";

export interface Note extends Spelling {
  duration: Duration;
}

export type Clef = "treble";

export interface Exercise {
  clef: Clef;
  beatsPerBar: number;
  bars: Note[][];
}

export interface Level {
  id: number;
  name: string;
  clef: Clef;
  lowest: Spelling;
  highest: Spelling;
  durations: Duration[];
}

export type NoteSource = "screen" | "midi" | "mic";

/**
 * The single event type every input produces. "on" is the onset (what grading
 * looks at); "off" is the release, used for key visuals and later for durations.
 */
export interface NoteEvent {
  kind: "on" | "off";
  pitch: number;
  time: number;
  velocity?: number;
  source: NoteSource;
}

export type NamingConvention = "english" | "swedish";
