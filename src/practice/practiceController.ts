import { Metronome } from "../audio/metronome";
import type { NoteStream } from "../input/noteStream";
import { generateExercise, type Random } from "../music/generator";
import { levelById } from "../music/levels";
import { midiOf } from "../music/pitch";
import { pressedCount, tiedOn } from "../music/ties";
import type { Exercise, NoteSource } from "../music/types";
import type { KeyFlash } from "../render/keyboardView";
import type { NotationOptions, NoteState } from "../render/notationView";
import { exactPitch } from "./matcher";
import { RhythmSession } from "./rhythmSession";
import type { Settings } from "./settings";
import { beatMs } from "./timing";
import { WaitSession, type NoteResult } from "./waitSession";

export const PHRASE_SCORE_DELAY_MS = 2500;
/** Failed attempts at full tempo before the player is offered a slower retry. */
export const SLOW_DOWN_AFTER_FAILURES = 3;
/** Each slow-down multiplies the tempo by this. */
export const SLOW_DOWN_FACTOR = 0.85;
const MIN_TEMPO = 30;
/** A0, the bottom key of an 88-key piano: pressing it on a MIDI keyboard restarts the phrase. */
export const RETRY_PITCH = 21;

/** The parts of NotationView the controller uses. */
export interface NotationDisplay {
  show(exercise: Exercise, options: NotationOptions): void;
  setOptions(options: NotationOptions): void;
  setState(index: number, state: NoteState): void;
  flashWrong(index: number): void;
}

/** The parts of KeyboardView the controller uses. */
export interface KeyboardDisplay {
  setPressed(midi: number, pressed: boolean): void;
  flash(midi: number, kind: KeyFlash): void;
}

export interface SoundOutput {
  play(pitch: number, velocity?: number): void;
  click?(accent?: boolean): void;
}

export interface ScoreDisplay {
  /** When `rhythmOnTime` is omitted, only the notes score is shown. */
  show(notesCorrect: number, total: number, rhythmOnTime?: number): void;
  setIncludeRhythm(include: boolean): void;
}

/** A phrase played to the end (stopped or skipped phrases never produce one). */
export interface PhraseResult {
  exercise: Exercise;
  mode: "wait" | "rhythm";
  /** Rhythm mode only. */
  tempo?: number;
  notes: NoteResult[];
  /** Where the phrase's note-ons came from; empty when nothing was played. */
  sources: NoteSource[];
  /** Every note hit with no wrong keys. */
  passed: boolean;
  /** Played below the phrase's tempo after slowing down. */
  slowed: boolean;
  /** What comes next: a new phrase, or this one again. */
  next: "new" | "retry";
  /** Clean full-tempo passes still needed before moving on; 0 when next is "new". */
  passesNeeded: number;
}

/** Where the player stands on the current phrase. */
export interface RetryState {
  /** Failed attempts at full tempo. */
  failures: number;
  /** Rhythm mode, after enough failures: slowDown() is available. */
  canSlowDown: boolean;
  /** The reduced tempo being practised; undefined at full tempo. */
  slowTempo?: number;
}

export interface PracticeDependencies {
  stream: NoteStream;
  notation: NotationDisplay;
  keyboard: KeyboardDisplay;
  sound: SoundOutput;
  settings: Settings;
  score?: ScoreDisplay;
  random?: Random;
  /** Fired when rhythm transport starts/stops (also false in wait mode). */
  onRhythmPlaybackChange?: (running: boolean) => void;
  onPhraseComplete?: (result: PhraseResult) => void;
  onRetryChange?: (state: RetryState) => void;
  /** Override for tests; defaults to performance.now. */
  now?: () => number;
}

/** Practice: Wait mode (pitch only) or Rhythm mode (live clock + score). */
export class PracticeController {
  private settings: Settings;
  private waitSession: WaitSession | null = null;
  private rhythmSession: RhythmSession | null = null;
  private currentExercise!: Exercise;
  private nextExerciseTimer: ReturnType<typeof setTimeout> | undefined;
  private tickTimer: ReturnType<typeof setTimeout> | undefined;
  private finishingRhythm = false;
  private rhythmRunning = false;
  private readonly metronome: Metronome | null;
  private readonly now: () => number;
  private readonly phraseSources = new Set<NoteSource>();
  private failures = 0;
  private slowTempo: number | undefined;
  /** Slowed down at some point on this phrase, so moving on takes two clean passes. */
  private slowedDown = false;
  /** Clean full-tempo passes in a row on this phrase. */
  private passes = 0;
  /** Whether keys played on a MIDI device also light up on the screen keyboard. */
  lightMidiKeys = false;
  /**
   * Makes each new phrase instead of the generator settings (curriculum stages, real
   * phrases); returning null falls back to the generator.
   */
  exerciseSource: (() => Exercise | null) | null = null;

  constructor(private readonly deps: PracticeDependencies) {
    this.settings = deps.settings;
    this.now = deps.now ?? (() => performance.now());
    this.metronome =
      deps.sound.click !== undefined
        ? new Metronome({ click: (accent) => deps.sound.click!(accent) })
        : null;

    deps.stream.subscribe((event) => {
      if (event.source === "midi" && event.pitch === RETRY_PITCH) {
        if (event.kind === "on") this.restartExercise();
        return;
      }
      // Sound first, before any DOM/VexFlow work — heavy sync work in the same
      // turn as AudioContext scheduling can delay the audible start.
      if (event.kind === "on") {
        deps.sound.play(event.pitch, event.velocity);
      }
      // Releases always clear, so turning the option off mid-note can't leave a key stuck down.
      if (event.kind === "off" || event.source !== "midi" || this.lightMidiKeys) {
        deps.keyboard.setPressed(event.pitch, event.kind === "on");
      }
      if (event.kind === "on") {
        this.phraseSources.add(event.source);
        const { pitch, time } = event;
        setTimeout(() => this.handleNoteOn(pitch, time), 0);
      }
    });
    this.startNewExercise();
  }

  get exercise(): Exercise {
    return this.currentExercise;
  }

  /** Pitch the player should hit next in wait mode; undefined in rhythm mode or when done. */
  get expectedPitch(): number | undefined {
    const session = this.waitSession;
    if (!session || session.isComplete) return undefined;
    return midiOf(session.notes[session.currentIndex]);
  }

  get retry(): RetryState {
    return {
      failures: this.failures,
      canSlowDown: this.settings.mode === "rhythm" && this.failures >= SLOW_DOWN_AFTER_FAILURES,
      slowTempo: this.slowTempo,
    };
  }

  /** True while rhythm count-in/phrase is actively running. */
  get isRhythmRunning(): boolean {
    return this.rhythmRunning;
  }

  /**
   * @param autoplay When true in rhythm mode, start count-in immediately.
   *   Mode switches leave rhythm stopped so the first keypress is not ignored
   *   during an unexpected count-in; New phrase / Restart / after-score pass true.
   * @param countInAt Wall-clock time when the next 1-bar count-in should begin
   *   (used to keep the metronome continuous across phrases).
   */
  startNewExercise(autoplay = false, countInAt?: number): void {
    this.currentExercise =
      this.exerciseSource?.() ??
      generateExercise(
        levelById(this.settings.range),
        {
          bars: this.settings.bars,
          key: this.settings.key,
          accidentalFrequency: this.settings.accidentalFrequency,
          rhythm: this.settings.rhythm,
          time: this.settings.time,
        },
        this.deps.random,
      );
    this.failures = 0;
    this.slowTempo = undefined;
    this.slowedDown = false;
    this.passes = 0;
    this.publishRetry();
    this.beginCurrentExercise(autoplay, countInAt);
  }

  /** Replay the same phrase from the start (wait or rhythm). */
  restartExercise(): void {
    this.beginCurrentExercise(true);
  }

  /**
   * Restart the phrase slower, once enough attempts have failed. Each call slows it
   * further; a clean slow pass goes back to full tempo, where two clean passes move on.
   */
  slowDown(): void {
    if (!this.retry.canSlowDown) return;
    this.slowTempo = Math.max(MIN_TEMPO, Math.round(this.tempo * SLOW_DOWN_FACTOR));
    this.slowedDown = true;
    this.passes = 0;
    this.publishRetry();
    this.beginCurrentExercise(true);
  }

  /** The tempo the next attempt runs at. */
  private get tempo(): number {
    return this.slowTempo ?? this.settings.tempo;
  }

  private publishRetry(): void {
    this.deps.onRetryChange?.(this.retry);
  }

  /** Stop the live clock and metronome. No-op outside rhythm mode or when already stopped. */
  stopRhythm(): void {
    if (this.settings.mode !== "rhythm" || !this.rhythmRunning) return;
    clearTimeout(this.nextExerciseTimer);
    this.finishingRhythm = false;
    this.teardownRhythm(true);
    this.deps.notation.show(this.currentExercise, this.notationOptions());
    this.deps.notation.setState(0, "current");
    this.setRhythmRunning(false);
  }

  /** Start (or restart) the current phrase on the live clock. No-op outside rhythm mode. */
  playRhythm(): void {
    if (this.settings.mode !== "rhythm") return;
    this.beginCurrentExercise(true);
  }

  /** Toggle stop/play in rhythm mode. */
  toggleRhythmPlayback(): void {
    if (this.settings.mode !== "rhythm") return;
    if (this.rhythmRunning) this.stopRhythm();
    else this.playRhythm();
  }

  private beginCurrentExercise(autoplay: boolean, countInAt?: number): void {
    clearTimeout(this.nextExerciseTimer);
    this.finishingRhythm = false;
    this.phraseSources.clear();
    // Keep clicks going when chaining into the next phrase; otherwise silence.
    this.teardownRhythm(!autoplay);
    this.deps.score?.setIncludeRhythm(this.settings.mode === "rhythm");
    this.deps.notation.show(this.currentExercise, this.notationOptions());

    if (this.settings.mode === "rhythm") {
      this.waitSession = null;
      if (autoplay) {
        this.startRhythmClock(countInAt);
      } else {
        this.rhythmSession = null;
        const total = pressedCount(this.currentExercise.bars.flat());
        this.publishScore(0, total, 0);
        this.deps.notation.setState(0, "current");
        this.setRhythmRunning(false);
      }
    } else {
      this.rhythmSession = null;
      this.waitSession = new WaitSession(this.currentExercise, exactPitch);
      this.publishScore(0, this.waitSession.notes.length);
      this.deps.notation.setState(0, "current");
      this.setRhythmRunning(false);
    }
  }

  private startRhythmClock(countInAt?: number): void {
    this.rhythmSession = new RhythmSession(this.currentExercise, this.tempo, exactPitch);
    this.publishLiveScore();
    // Count-in is a bar (more before a pickup); align to countInAt when continuing from the previous phrase.
    const wallStart = countInAt ?? this.now();
    this.rhythmSession.arm(wallStart);
    this.metronome?.start(
      this.tempo,
      this.rhythmSession.totalBeats,
      wallStart,
      this.rhythmSession.beatsPerBar,
    );
    // No "current" highlight during count-in — tick will set it when the phrase begins.
    this.scheduleTick();
    this.setRhythmRunning(true);
  }

  private publishScore(notesCorrect: number, total: number, rhythmOnTime?: number): void {
    this.deps.score?.show(notesCorrect, total, rhythmOnTime);
  }

  private publishLiveScore(): void {
    if (this.rhythmSession) {
      const score = this.rhythmSession.score();
      this.publishScore(score.notesCorrect, score.total, score.rhythmOnTime);
      return;
    }
    if (this.waitSession) {
      const score = this.waitSession.score();
      this.publishScore(score.notesCorrect, score.total);
    }
  }

  private setRhythmRunning(running: boolean): void {
    if (this.rhythmRunning === running) return;
    this.rhythmRunning = running;
    this.deps.onRhythmPlaybackChange?.(running);
  }

  updateSettings(settings: Settings, changed: keyof Settings): void {
    this.settings = settings;
    if (
      changed === "bars" ||
      changed === "key" ||
      changed === "accidentalFrequency" ||
      changed === "rhythm" ||
      changed === "time" ||
      changed === "source" ||
      changed === "clef" ||
      changed === "range" ||
      changed === "mode" ||
      changed === "tempo"
    ) {
      this.startNewExercise();
    } else {
      this.deps.notation.setOptions(this.notationOptions());
    }
  }

  private handleNoteOn(pitch: number, time: number): void {
    if (this.settings.mode === "rhythm") {
      this.handleRhythmNoteOn(pitch, time);
    } else {
      this.handleWaitNoteOn(pitch);
    }
  }

  private handleWaitNoteOn(pitch: number): void {
    const session = this.waitSession;
    if (!session) return;
    const { notation, keyboard } = this.deps;
    const result = session.play(pitch);
    switch (result.kind) {
      case "correct":
        this.setPressedState(session.notes, result.index, session.wrongAt(result.index) > 0 ? "wrong" : "correct");
        keyboard.flash(pitch, "correct");
        this.publishLiveScore();
        if (result.completed) {
          this.finishWaitPhrase();
        } else {
          notation.setState(session.currentIndex, "current");
        }
        break;
      case "wrong":
        notation.flashWrong(result.index);
        keyboard.flash(pitch, "wrong");
        keyboard.flash(result.expectedPitch, "hint");
        break;
      case "ignored":
        break;
    }
  }

  private handleRhythmNoteOn(pitch: number, time: number): void {
    const session = this.rhythmSession;
    if (!session) return;
    const { notation, keyboard } = this.deps;
    const { missed, result } = session.play(pitch, time);
    this.applyMisses(missed);

    switch (result.kind) {
      case "correct": {
        const state: NoteState =
          session.wrongAt(result.index) > 0 ? "wrong" : result.timing === "on-time" ? "correct" : "late";
        this.setPressedState(session.notes, result.index, state);
        keyboard.flash(pitch, result.timing === "on-time" ? "correct" : "hint");
        this.publishLiveScore();
        if (result.completed) {
          this.finishRhythmPhrase();
        } else if (!session.isCountingIn(this.now())) {
          notation.setState(session.currentIndex, "current");
        }
        break;
      }
      case "wrong":
        notation.flashWrong(result.index);
        keyboard.flash(pitch, "wrong");
        keyboard.flash(result.expectedPitch, "hint");
        break;
      case "ignored":
        if (session.isComplete) this.finishRhythmPhrase();
        break;
    }
  }

  /** Colours a pressed note and the notes tied on from it. */
  private setPressedState(notes: Exercise["bars"][number], index: number, state: NoteState): void {
    for (const i of [index, ...tiedOn(notes, index)]) this.deps.notation.setState(i, state);
  }

  private scheduleTick(): void {
    clearTimeout(this.tickTimer);
    const session = this.rhythmSession;
    if (!session || session.isComplete) return;

    this.tickTimer = setTimeout(() => {
      const now = this.now();
      const { missed, currentIndex, completed } = session.tick(now);
      this.applyMisses(missed);
      if (completed) {
        this.finishRhythmPhrase();
        return;
      }
      if (!session.isCountingIn(now) && currentIndex < session.notes.length) {
        this.deps.notation.setState(currentIndex, "current");
      }
      this.scheduleTick();
    }, 30);
  }

  private applyMisses(missed: number[]): void {
    if (missed.length === 0) return;
    const { notation } = this.deps;
    for (const index of missed) {
      notation.setState(index, "wrong");
    }
    this.publishLiveScore();
    const session = this.rhythmSession;
    if (session && !session.isComplete) {
      notation.setState(session.currentIndex, "current");
    }
  }

  private finishWaitPhrase(): void {
    this.publishLiveScore();
    const session = this.waitSession;
    if (!session) return;
    const next = this.settleAttempt("wait", session.results());
    clearTimeout(this.nextExerciseTimer);
    // A retry is a clean sheet; the marks from this attempt stay up until then.
    this.nextExerciseTimer = setTimeout(
      () => (next === "new" ? this.startNewExercise() : this.beginCurrentExercise(false)),
      PHRASE_SCORE_DELAY_MS,
    );
  }

  private finishRhythmPhrase(): void {
    if (this.finishingRhythm) return;
    this.finishingRhythm = true;
    clearTimeout(this.tickTimer);
    this.tickTimer = undefined;
    // Leave the metronome running through the end of the bar; the next phrase's
    // count-in starts on the barline after this phrase's last note.
    this.publishLiveScore();

    const session = this.rhythmSession;
    if (!session) return;
    const next = this.settleAttempt("rhythm", session.results(), session.tempo);
    const phraseEnd = session.endAt ?? this.now();
    // A retry rests a beat after the last bar, then counts in a bar on a clean sheet.
    const countInAt = next === "new" ? phraseEnd : phraseEnd + beatMs(session.tempo);
    clearTimeout(this.nextExerciseTimer);
    this.nextExerciseTimer = setTimeout(() => {
      if (next === "new") this.startNewExercise(true, countInAt);
      else this.beginCurrentExercise(true, countInAt);
    }, Math.max(0, countInAt - this.now()));
  }

  /**
   * Grades a finished attempt, updates where the player stands on the phrase, and
   * reports it. A pass turns every note green.
   */
  private settleAttempt(mode: PhraseResult["mode"], notes: NoteResult[], tempo?: number): PhraseResult["next"] {
    const passed = notes.every((n) => n.hit && n.wrong === 0);
    const slowed = this.slowTempo !== undefined;
    if (slowed) {
      if (passed) this.slowTempo = undefined;
    } else if (passed) {
      this.passes++;
    } else {
      this.failures++;
      this.passes = 0;
    }
    const passesNeeded = (this.slowedDown ? 2 : 1) - this.passes;
    const next = passesNeeded === 0 ? "new" : "retry";
    if (passed) notes.forEach((_, i) => this.deps.notation.setState(i, "correct"));

    this.deps.onPhraseComplete?.({
      exercise: this.currentExercise,
      mode,
      tempo,
      notes,
      sources: [...this.phraseSources],
      passed,
      slowed,
      next,
      passesNeeded,
    });
    this.publishRetry();
    return next;
  }

  private teardownRhythm(stopMetronome: boolean): void {
    clearTimeout(this.tickTimer);
    this.tickTimer = undefined;
    if (stopMetronome) this.metronome?.stop();
    this.rhythmSession = null;
  }

  private notationOptions(): NotationOptions {
    return { showNames: this.settings.namesOnNotes };
  }
}
