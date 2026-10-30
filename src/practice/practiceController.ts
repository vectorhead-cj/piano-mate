import { Metronome } from "../audio/metronome";
import type { NoteStream } from "../input/noteStream";
import { generateExercise, type Random } from "../music/generator";
import { levelById } from "../music/levels";
import { midiOf } from "../music/pitch";
import { BEATS } from "../music/rhythms";
import type { Exercise } from "../music/types";
import type { KeyFlash } from "../render/keyboardView";
import type { NotationOptions, NoteState } from "../render/notationView";
import { exactPitch } from "./matcher";
import { RhythmSession } from "./rhythmSession";
import type { Settings } from "./settings";
import { WaitSession } from "./waitSession";

export const PHRASE_SCORE_DELAY_MS = 2500;

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
  /** Whether keys played on a MIDI device also light up on the screen keyboard. */
  lightMidiKeys = false;

  constructor(private readonly deps: PracticeDependencies) {
    this.settings = deps.settings;
    this.now = deps.now ?? (() => performance.now());
    this.metronome =
      deps.sound.click !== undefined
        ? new Metronome({ click: (accent) => deps.sound.click!(accent) })
        : null;

    deps.stream.subscribe((event) => {
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
    this.currentExercise = generateExercise(
      levelById(this.settings.range),
      {
        bars: this.settings.bars,
        key: this.settings.key,
        accidentalFrequency: this.settings.accidentalFrequency,
        rhythm: this.settings.rhythm,
      },
      this.deps.random,
    );
    this.beginCurrentExercise(autoplay, countInAt);
  }

  /** Replay the same phrase from the start (wait or rhythm). */
  restartExercise(): void {
    this.beginCurrentExercise(true);
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
        const total = this.currentExercise.bars.flat().length;
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
    this.rhythmSession = new RhythmSession(
      this.currentExercise,
      this.settings.tempo,
      exactPitch,
    );
    this.publishLiveScore();
    // Count-in is always one bar; align to countInAt when continuing from the previous phrase.
    const wallStart = countInAt ?? this.now();
    this.rhythmSession.arm(wallStart);
    const phraseBeats = this.currentExercise.bars
      .flat()
      .reduce((sum, note) => sum + BEATS[note.duration], 0);
    this.metronome?.start(
      this.settings.tempo,
      this.rhythmSession.countInBeats + phraseBeats,
      wallStart,
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
        notation.setState(result.index, "correct");
        keyboard.flash(pitch, "correct");
        this.publishLiveScore();
        if (result.completed) {
          this.finishWaitPhrase();
        } else {
          notation.setState(result.index + 1, "current");
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
        const state: NoteState = result.timing === "on-time" ? "correct" : "late";
        notation.setState(result.index, state);
        keyboard.flash(pitch, result.timing === "on-time" ? "correct" : "hint");
        this.publishLiveScore();
        if (result.completed) {
          this.finishRhythmPhrase();
        } else if (!session.isCountingIn(this.now())) {
          notation.setState(result.index + 1, "current");
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
    clearTimeout(this.nextExerciseTimer);
    this.nextExerciseTimer = setTimeout(() => this.startNewExercise(), PHRASE_SCORE_DELAY_MS);
  }

  private finishRhythmPhrase(): void {
    if (this.finishingRhythm) return;
    this.finishingRhythm = true;
    clearTimeout(this.tickTimer);
    this.tickTimer = undefined;
    // Leave the metronome running through the end of the bar; the next phrase's
    // count-in starts exactly when this phrase's musical duration ends.
    this.publishLiveScore();

    const session = this.rhythmSession;
    const phraseEnd =
      session?.phraseStart !== null && session?.phraseStart !== undefined
        ? session.phraseStart + session.phraseMs
        : this.now();
    const delay = Math.max(0, phraseEnd - this.now());
    clearTimeout(this.nextExerciseTimer);
    this.nextExerciseTimer = setTimeout(() => {
      this.startNewExercise(true, phraseEnd);
    }, delay);
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
