export type Letter = "C" | "D" | "E" | "F" | "G" | "A" | "B";

/** -1 = flat, 0 = natural, 1 = sharp */
export type Alter = -1 | 0 | 1;

export interface Spelling {
  letter: Letter;
  alter: Alter;
  octave: number;
}

/** Note values: whole, dotted half, half, dotted quarter, quarter, eighth. */
export type Duration = "w" | "h." | "h" | "q." | "q" | "8";

/** 2/2 bars hold the same notes as 4/4; only the printed signature differs. */
export type TimeSignature = "4/4" | "3/4" | "2/2";

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
  time: TimeSignature;
  /**
   * Quarter beats in an opening pickup bar, or 0 when the phrase starts on beat 1.
   * The first bar then holds only the pickup; every later bar is full except
   * possibly the last, where a phrase may end mid-bar.
   */
  pickup: number;
  bars: Note[][];
}

export interface Level {
  id: string;
  name: string;
  clef: Clef;
  lowest: Spelling;
  highest: Spelling;
  /**
   * The next-narrower range inside this one, which phrases are nudged to leave.
   * Presets in LEVELS leave it out and use lesserLevel instead.
   */
  inner?: { lowest: Spelling; highest: Spelling };
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
