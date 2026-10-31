import { midiOf } from "../music/pitch";
import { barBeats, BEATS } from "../music/rhythms";
import { isTieContinuation, tiedOn } from "../music/ties";
import type { Exercise } from "../music/types";
import { beatMs, expectedOnsets } from "../practice/timing";

export interface PlaybackSound {
  play(pitch: number, velocity?: number, holdSeconds?: number): void;
  click(accent?: boolean): void;
}

export interface PlaybackListener {
  /** A note's onset, tied continuations included. */
  onNote?(index: number): void;
  /** A key goes down at a note's onset and up before the next. */
  onKey?(pitch: number, down: boolean): void;
  /** Played to the barline after the last note (not called when stopped). */
  onEnd?(): void;
}

/** Share of a note's length it sounds for, so repeated notes are heard as separate presses. */
const LEGATO = 0.9;
const VELOCITY = 0.8;

/**
 * Plays a phrase the way the player is asked to: a bar's count-in (more before a pickup, as in
 * RhythmSession), then each note on time with the metronome clicking through to the barline.
 * Times are scheduled from one epoch, like the Metronome, so they don't drift.
 */
export class PhrasePlayer {
  private timers: ReturnType<typeof setTimeout>[] = [];
  private keysDown = new Set<number>();
  private listener: PlaybackListener | null = null;

  constructor(
    private readonly sound: PlaybackSound,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get playing(): boolean {
    return this.timers.length > 0;
  }

  play(exercise: Exercise, tempo: number, listener: PlaybackListener = {}): void {
    this.stop();
    this.listener = listener;
    const notes = exercise.bars.flat();
    const ms = beatMs(tempo);
    const beatsPerBar = barBeats(exercise.time);
    const countInBeats = exercise.pickup > 0 ? 2 * beatsPerBar - exercise.pickup : beatsPerBar;
    const phraseBeats = notes.reduce((sum, note) => sum + BEATS[note.duration], 0);
    const totalBeats = Math.ceil((countInBeats + phraseBeats) / beatsPerBar) * beatsPerBar;
    const onsets = expectedOnsets(notes, tempo);
    const start = this.now();
    const first = countInBeats * ms;
    const at = (offset: number, action: () => void) => {
      this.timers.push(setTimeout(action, Math.max(0, start + offset - this.now())));
    };

    for (let beat = 0; beat < totalBeats; beat++) {
      at(beat * ms, () => this.sound.click(beat % beatsPerBar === 0));
    }
    notes.forEach((note, i) => {
      at(first + onsets[i], () => listener.onNote?.(i));
      if (isTieContinuation(notes, i)) return;
      const held = [i, ...tiedOn(notes, i)].reduce((sum, j) => sum + BEATS[notes[j].duration], 0) * ms * LEGATO;
      const pitch = midiOf(note);
      at(first + onsets[i], () => {
        this.sound.play(pitch, VELOCITY, held / 1000);
        this.keysDown.add(pitch);
        listener.onKey?.(pitch, true);
      });
      at(first + onsets[i] + held, () => this.release(pitch));
    });
    at(totalBeats * ms, () => {
      this.timers = [];
      this.listener = null;
      listener.onEnd?.();
    });
  }

  /** Stops at once, letting go of any keys still down. */
  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    for (const pitch of [...this.keysDown]) this.release(pitch);
    this.listener = null;
  }

  private release(pitch: number): void {
    if (!this.keysDown.delete(pitch)) return;
    this.listener?.onKey?.(pitch, false);
  }
}
