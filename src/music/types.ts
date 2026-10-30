export type Letter = "C" | "D" | "E" | "F" | "G" | "A" | "B";

/** -1 = flat, 0 = natural, 1 = sharp */
export type Alter = -1 | 0 | 1;

export interface Spelling {
  letter: Letter;
  alter: Alter;
  octave: number;
}

/** VexFlow duration codes: whole, half, quarter, eighth. */
export type Duration = "w" | "h" | "q" | "8";

export interface Note extends Spelling {
  duration: Duration;
}

export type Clef = "treble" | "bass";

/** How often non-diatonic note accidentals (including naturals that cancel the key) appear. */
export type AccidentalFrequency = "none" | "rare" | "medium" | "common";

/** Note-value mix used when generating rhythms (independent of pitch range). */
export type RhythmFlavor = "basic" | "eighths" | "busy";

export interface Exercise {
  clef: Clef;
  /** VexFlow major-key spec for the staff key signature. */
  key: string;
  beatsPerBar: number;
  bars: Note[][];
}

export interface Level {
  id: string;
  name: string;
  clef: Clef;
  lowest: Spelling;
  highest: Spelling;
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
