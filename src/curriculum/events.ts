import { cleanNote, type HoldStrictness } from "../practice/holds";
import { onTimeWindowMs } from "../practice/timing";
import type { NoteResult } from "../practice/waitSession";
import type { AccidentalFrequency, Alter, Clef, Duration, Letter, RhythmFlavor, Spelling, TimeSignature } from "../music/types";
import type { Tier } from "./curriculum";

/**
 * The event log stores only what happened. Stars, streaks and unlocks are all derived from
 * it (see progress.ts), so scoring rules can change and old practice is re-scored.
 */

/** What one note of a finished phrase looked like when played. */
export interface NoteOutcome {
  /** Spelled pitch, e.g. "F#4" or "Bb3". */
  pitch: string;
  duration: Duration;
  /** Wrong keys pressed while this note was the one to play (rhythm mode: and right keys too early). */
  wrong: number;
  /** Played with the right pitch (rhythm mode: inside the accept window; wait mode: always). */
  hit: boolean;
  /** Held on from the note before through a tie: it shares that note's result and isn't pressed. */
  tied?: true;
  /** Rhythm mode only: ms from the expected onset to the press (negative = early). */
  offsetMs?: number;
  /** Rhythm mode only: of the `wrong` presses, how many were the right key before its window. */
  early?: number;
  /** Rhythm mode only: ms from the note's written end to the key's release (negative = let go early). */
  releaseMs?: number;
  /** Rhythm mode only: let go too soon or held too long, by the phrase's hold policy. */
  hold?: "short" | "long";
}

export type PracticeContext =
  | { kind: "curriculum"; clef: Clef; stageId: string; tier: Tier }
  | { kind: "custom" };

/** "midi" only when every note-on in the phrase came from a MIDI device. */
export type InputKind = "midi" | "screen" | "mixed";

export interface PhraseCompleted {
  type: "phrase-completed";
  /** Schema version of this event. */
  v: 1;
  id: string;
  /** Epoch ms when the phrase finished. */
  at: number;
  /** Epoch ms of the attempt's first key press; left out by events recorded before it was. */
  startedAt?: number;
  /** One page load. */
  session: string;
  context: PracticeContext;
  mode: "wait" | "rhythm";
  /** Rhythm mode only. */
  tempo?: number;
  /** Rhythm mode only: how strictly holds were graded; left out before holds were graded. */
  holds?: HoldStrictness;
  input: InputKind;
  /** Connected MIDI device names at the time, if any. */
  devices?: string[];
  /** The generator settings the phrase came from, as they were then. */
  config: {
    clef: Clef;
    key: string;
    lowest: string;
    highest: string;
    accidentals: AccidentalFrequency;
    rhythm: RhythmFlavor;
    bars: number;
    /** Left out by events recorded before phrases had other time signatures (all 4/4). */
    time?: TimeSignature;
  };
  /** The real phrase played (see src/music/corpus.ts); absent for generated phrases. */
  phraseId?: string;
  /** In a mixing tier, the earlier stage the phrase was dealt from; absent for the stage's own. */
  reviewStageId?: string;
  /** Notes per bar, so a note index maps back to its bar. */
  barSizes: number[];
  notes: NoteOutcome[];
}

/** A stage's intro to new notation, watched through or skipped; either way it isn't shown again unasked. */
export interface IntroCompleted {
  type: "intro-completed";
  v: 1;
  id: string;
  at: number;
  session: string;
  clef: Clef;
  stageId: string;
  skipped: boolean;
}

/**
 * The player chose to start a track at this stage: it and every stage before it open, without
 * earning their stars. The latest one per track counts.
 */
export interface TrackStarted {
  type: "track-started";
  v: 1;
  id: string;
  at: number;
  session: string;
  clef: Clef;
  stageId: string;
}

export type PracticeEvent = PhraseCompleted | IntroCompleted | TrackStarted;

const ALTER_TEXT: Record<Alter, string> = { [-1]: "b", 0: "", 1: "#" };

export function spellingText(spelling: Spelling): string {
  return `${spelling.letter}${ALTER_TEXT[spelling.alter]}${spelling.octave}`;
}

export function parseSpelling(text: string): Spelling {
  const match = /^([A-G])(#|b)?(-?\d+)$/.exec(text);
  if (!match) throw new Error(`Bad spelling: ${text}`);
  const alter: Alter = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  return { letter: match[1] as Letter, alter, octave: Number(match[3]) };
}

/** Every note right first time (and, in rhythm mode, inside its timing window and held right when holds count). */
export function isPerfect(event: PhraseCompleted): boolean {
  return event.notes.every((n) => cleanNote(n, event.holds));
}

/** Whether a phrase can earn or break curriculum progress: MIDI input only. */
export function countsForProgress(event: PhraseCompleted): boolean {
  return event.input === "midi";
}

/** Rhythm mode: share of notes inside the tighter on-time window, 0–1. Undefined in wait mode. */
export function timingBonus(event: PhraseCompleted): number | undefined {
  const pressed = event.notes.filter((n) => !n.tied);
  if (event.mode !== "rhythm" || event.tempo === undefined || pressed.length === 0) return undefined;
  const window = onTimeWindowMs(event.tempo);
  const onTime = pressed.filter((n) => n.hit && n.offsetMs !== undefined && Math.abs(n.offsetMs) <= window);
  return onTime.length / pressed.length;
}

const BEATS_PER_BAR: Record<TimeSignature, number> = { "4/4": 4, "3/4": 3, "2/2": 2 };

/** How long a phrase took to play; without startedAt, four bars at 60 bpm. */
export function playedMs(event: PhraseCompleted): number {
  if (event.startedAt !== undefined) return Math.max(0, event.at - event.startedAt);
  return 4 * BEATS_PER_BAR[event.config.time ?? "4/4"] * 1000;
}

export type PhraseFault = { kind: "wrong" | "early" | "missed" | "short" | "long"; bar: number; index: number };

/** The first note that kept a phrase from being perfect, if any. */
export function firstFault(
  event: Pick<PhraseCompleted, "barSizes" | "holds"> & { notes: readonly NoteResult[] },
): PhraseFault | undefined {
  const index = event.notes.findIndex((n) => !cleanNote(n, event.holds));
  if (index < 0) return undefined;
  const note = event.notes[index];
  let bar = 0;
  let notesBefore = 0;
  while (bar < event.barSizes.length - 1 && index >= notesBefore + event.barSizes[bar]) {
    notesBefore += event.barSizes[bar];
    bar++;
  }
  const kind =
    note.hit && note.wrong === 0 ? note.hold! : note.wrong === 0 ? "missed" : note.wrong === note.early ? "early" : "wrong";
  return { kind, bar: bar + 1, index };
}

export function newId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
}
