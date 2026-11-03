import { Metronome } from "../audio/metronome";
import type { NoteStream } from "../input/noteStream";
import { generateExercise, type Random } from "../music/generator";
import { levelById } from "../music/levels";
import { midiOf } from "../music/pitch";
import { pressedIndices, tiedOn } from "../music/ties";
import type { Exercise, NoteSource } from "../music/types";
import type { KeyFlash } from "../render/keyboardView";
import type { HoldMark, NotationOptions, NoteState } from "../render/notationView";
import { faultyNotes, FORGIVEN_HOLD_FAULTS, HOLD_POLICIES, type HoldStrictness } from "./holds";
import { exactPitch } from "./matcher";
import { RhythmSession } from "./rhythmSession";
import type { Settings } from "./settings";
import { beatMs } from "./timing";
import { WaitSession, type Mark, type NoteResult } from "./waitSession";

export const PHRASE_SCORE_DELAY_MS = 2500;
/** Silent beats before the count-in of a phrase in a new key, to take in its key signature. */
export const KEY_CHANGE_BEATS = 2;
/** Failed attempts at full tempo before the player is offered a slower retry. */
export const SLOW_DOWN_AFTER_FAILURES = 3;
/** Each slow-down multiplies the tempo by this. */
export const SLOW_DOWN_FACTOR = 0.85;
const MIN_TEMPO = 30;
/** Default retry key: A0, the bottom key of an 88-key piano. Pressing it on a MIDI keyboard toggles hot/cold. */
export const RETRY_PITCH = 21;

/** The parts of NotationView the controller uses. */
export interface NotationDisplay {
  show(exercise: Exercise, options: NotationOptions): void;
  setOptions(options: NotationOptions): void;
  setState(index: number, state: NoteState): void;
  flashWrong(index: number): void;
  /** Circles the key signature (where it would be, in C) once the phrase being shown is drawn. */
  circleKeySignature?(): void;
  /** Draws how long a pressed note was held against its written length; null clears it. */
  setHold?(index: number, hold: HoldMark | null): void;
}

/** The parts of KeyboardView the controller uses. */
export interface KeyboardDisplay {
  setPressed(midi: number, pressed: boolean): void;
  flash(midi: number, kind: KeyFlash): void;
  /** Lights a key for as long as its note should be held. */
  setGuide?(midi: number, on: boolean): void;
}

export interface SoundOutput {
  play(pitch: number, velocity?: number): void;
  click?(accent?: boolean): void;
}

/** A mark per pressed note; `rhythm` lines up with `notes` and is left out in Wait mode. */
export interface ScoreMarks {
  notes: Mark[];
  rhythm?: Mark[];
}

export interface ScoreDisplay {
  show(marks: ScoreMarks): void;
  setIncludeRhythm(include: boolean): void;
}

/** A phrase played to the end (stopped or skipped phrases never produce one). */
export interface PhraseResult {
  exercise: Exercise;
  mode: "wait" | "rhythm";
  /** Rhythm mode only. */
  tempo?: number;
  /** Rhythm mode only: how strictly holds were graded. */
  holds?: HoldStrictness;
  notes: NoteResult[];
  /** Where the phrase's note-ons came from; empty when nothing was played. */
  sources: NoteSource[];
  /** From the attempt's first note-on to its end; 0 when nothing was played. */
  playedMs: number;
  /** Every note hit with no wrong keys. */
  passed: boolean;
  /** Went cold partway through; always a failure. */
  abandoned: boolean;
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
  /** Fired when practice goes hot (attempts graded) or cold (free play). */
  onHotChange?: (hot: boolean) => void;
  onPhraseComplete?: (result: PhraseResult) => void;
  onRetryChange?: (state: RetryState) => void;
  /** Every key pressed or released (not the start/stop key), hot or cold. */
  onPlayed?: (pitch: number, down: boolean) => void;
  /** Override for tests; defaults to performance.now. */
  now?: () => number;
}

/**
 * Practice: Wait mode (pitch only) or Rhythm mode (live clock + score).
 *
 * Hot means the current attempt is graded; cold is free play, where notes sound but
 * nothing is graded or advances (and rhythm mode's clock is stopped). A failed attempt
 * drops to cold with its marks left up; going hot again retries on a clean sheet.
 */
export class PracticeController {
  private settings: Settings;
  private waitSession: WaitSession | null = null;
  private rhythmSession: RhythmSession | null = null;
  private currentExercise!: Exercise;
  private nextExerciseTimer: ReturnType<typeof setTimeout> | undefined;
  private tickTimer: ReturnType<typeof setTimeout> | undefined;
  private finishingRhythm = false;
  private hot = false;
  /** A passed attempt has queued a new phrase, which going hot again should start. */
  private pendingNew = false;
  private readonly metronome: Metronome | null;
  private readonly now: () => number;
  private readonly phraseSources = new Set<NoteSource>();
  /** When the attempt's first note-on came, by `now`. */
  private phraseStartedAt: number | undefined;
  private failures = 0;
  private slowTempo: number | undefined;
  /** Slowed down at some point on this phrase, so moving on takes two clean passes. */
  private slowedDown = false;
  /** Clean full-tempo passes in a row on this phrase. */
  private passes = 0;
  /** Set while waiting for the player to press a key to use as the retry key. */
  private keyCapture: ((pitch: number) => void) | null = null;
  /** Whether keys played on a MIDI device also light up on the screen keyboard. */
  lightMidiKeys = false;
  /** Whether keys played on a MIDI device also sound on the synth; the device usually has its own. */
  soundMidiKeys = false;
  /** MIDI key that toggles hot/cold instead of playing a note. */
  retryPitch = RETRY_PITCH;
  /**
   * After a pass, go cold instead of moving straight on, so the caller decides when the next
   * phrase starts (intros explain each one first). Going hot again then starts it.
   */
  pauseAfterPass = false;
  /**
   * Makes each new phrase instead of the generator settings (curriculum stages, real
   * phrases); returning null falls back to the generator.
   */
  exerciseSource: (() => Exercise | null) | null = null;
  /** How strictly rhythm mode grades holds; each attempt takes it as it starts. */
  holdStrictness: HoldStrictness = "coach";
  /** Show, while coaching, how long to hold each note: a trail on the staff and a lit key. */
  holdGuide = true;
  /** Keys lit by the hold guide, with when each note's written length ends. */
  private readonly guides = new Map<number, number>();

  constructor(private readonly deps: PracticeDependencies) {
    this.settings = deps.settings;
    this.now = deps.now ?? (() => performance.now());
    this.metronome =
      deps.sound.click !== undefined
        ? new Metronome({ click: (accent) => deps.sound.click!(accent) })
        : null;

    deps.stream.subscribe((event) => {
      if (event.source === "midi" && this.keyCapture) {
        if (event.kind === "on") {
          const capture = this.keyCapture;
          this.keyCapture = null;
          capture(event.pitch);
        }
        return;
      }
      if (event.source === "midi" && event.pitch === this.retryPitch) {
        if (event.kind === "on") this.toggleHot();
        return;
      }
      // Sound first, before any DOM/VexFlow work — heavy sync work in the same
      // turn as AudioContext scheduling can delay the audible start.
      if (event.kind === "on" && (event.source !== "midi" || this.soundMidiKeys)) {
        deps.sound.play(event.pitch, event.velocity);
      }
      // Releases always clear, so turning the option off mid-note can't leave a key stuck down.
      if (event.kind === "off" || event.source !== "midi" || this.lightMidiKeys) {
        deps.keyboard.setPressed(event.pitch, event.kind === "on");
      }
      deps.onPlayed?.(event.pitch, event.kind === "on");
      if (event.kind === "on" && this.hot) {
        this.phraseSources.add(event.source);
        this.phraseStartedAt ??= this.now();
        const { pitch, time } = event;
        setTimeout(() => this.handleNoteOn(pitch, time), 0);
      } else if (event.kind === "off" && this.hot && this.settings.mode === "rhythm") {
        const { pitch, time } = event;
        setTimeout(() => this.handleRhythmNoteOff(pitch, time), 0);
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

  /** True while attempts are graded; false in free play. */
  get isHot(): boolean {
    return this.hot;
  }

  /**
   * @param autoplay Arrive hot in rhythm mode, starting the count-in. Wait mode always
   *   arrives hot. Loads and settings changes leave rhythm cold, so the metronome never
   *   starts unasked.
   * @param countInAt Wall-clock time when the next 1-bar count-in should begin
   *   (used to keep the metronome continuous across phrases).
   */
  startNewExercise(autoplay = false, countInAt?: number): void {
    const previousKey = this.currentExercise?.key;
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
    const keyChanged = previousKey !== undefined && previousKey !== this.currentExercise.key;
    this.beginCurrentExercise(autoplay || this.settings.mode === "wait", countInAt, keyChanged);
  }

  /** Start a graded attempt on a clean sheet; rhythm mode rests a beat, then counts in a bar. */
  goHot(): void {
    if (this.hot) return;
    const countInAt = this.settings.mode === "rhythm" ? this.now() + beatMs(this.tempo) : undefined;
    if (this.pendingNew) this.startNewExercise(true, countInAt);
    else this.beginCurrentExercise(true, countInAt);
  }

  /** Drop to free play. Bailing out of an attempt that has begun counts as a failure. */
  goCold(): void {
    if (!this.hot) return;
    clearTimeout(this.nextExerciseTimer);
    const session = this.waitSession ?? this.rhythmSession;
    const begun =
      session !== null &&
      !session.isComplete &&
      (session.currentIndex > 0 || session.results().some((n) => n.wrong > 0));
    const tempo = this.rhythmSession?.tempo;
    const holds = this.rhythmSession ? this.holdsOf(this.rhythmSession) : undefined;
    this.teardownRhythm(true);
    this.setHot(false);
    if (begun) this.settleAttempt(this.settings.mode, session.results(), tempo, true, holds);
  }

  /**
   * Hands the next MIDI key pressed to `onKey` instead of playing or grading it; MIDI
   * input is swallowed until then. Returns a function that stops waiting.
   */
  captureMidiKey(onKey: (pitch: number) => void): () => void {
    this.keyCapture = onKey;
    return () => {
      if (this.keyCapture === onKey) this.keyCapture = null;
    };
  }

  toggleHot(): void {
    if (this.hot) this.goCold();
    else this.goHot();
  }

  /** Clears the current phrase's marks and leaves it waiting, cold, for an attempt. */
  resetCold(): void {
    this.goCold();
    this.beginCurrentExercise(this.settings.mode === "wait");
  }

  /**
   * Slow the phrase down, once enough attempts have failed, and drop to cold to start
   * it. Each call slows it further; a clean slow pass goes back to full tempo, where
   * two clean passes move on.
   */
  slowDown(): void {
    if (!this.retry.canSlowDown) return;
    this.goCold();
    this.slowTempo = Math.max(MIN_TEMPO, Math.round(this.tempo * SLOW_DOWN_FACTOR));
    this.slowedDown = true;
    this.passes = 0;
    this.pendingNew = false;
    this.publishRetry();
  }

  /** The tempo the next attempt runs at. */
  private get tempo(): number {
    return this.slowTempo ?? this.settings.tempo;
  }

  private publishRetry(): void {
    this.deps.onRetryChange?.(this.retry);
  }

  /** @param keyChanged The phrase is in a new key: its signature is circled, and rhythm mode waits a little before counting in. */
  private beginCurrentExercise(hot: boolean, countInAt?: number, keyChanged = false): void {
    clearTimeout(this.nextExerciseTimer);
    this.finishingRhythm = false;
    this.pendingNew = false;
    this.phraseSources.clear();
    this.phraseStartedAt = undefined;
    // Keep clicks going when chaining into the next phrase; otherwise silence.
    this.teardownRhythm(!hot);
    this.deps.score?.setIncludeRhythm(this.settings.mode === "rhythm");
    this.deps.notation.show(this.currentExercise, this.notationOptions());
    if (keyChanged) this.deps.notation.circleKeySignature?.();

    if (this.settings.mode === "rhythm") {
      this.waitSession = null;
      if (hot) {
        const settle = keyChanged ? KEY_CHANGE_BEATS * beatMs(this.tempo) : 0;
        this.startRhythmClock((countInAt ?? this.now()) + settle);
      } else {
        this.rhythmSession = null;
        const pending = pressedIndices(this.currentExercise.bars.flat()).map((): Mark => "pending");
        this.publishScore({ notes: pending, rhythm: pending });
        this.deps.notation.setState(0, "current");
      }
    } else {
      this.rhythmSession = null;
      this.waitSession = new WaitSession(this.currentExercise, exactPitch);
      this.publishScore({ notes: this.waitSession.marks() });
      this.deps.notation.setState(0, "current");
    }
    this.setHot(hot);
  }

  private startRhythmClock(countInAt?: number): void {
    this.rhythmSession = new RhythmSession(this.currentExercise, this.tempo, exactPitch, HOLD_POLICIES[this.holdStrictness]);
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
  }

  private publishScore(marks: ScoreMarks): void {
    this.deps.score?.show(marks);
  }

  private publishLiveScore(): void {
    if (this.rhythmSession) {
      this.publishScore(this.rhythmSession.marks());
      return;
    }
    if (this.waitSession) {
      this.publishScore({ notes: this.waitSession.marks() });
    }
  }

  private setHot(hot: boolean): void {
    if (this.hot === hot) return;
    this.hot = hot;
    this.deps.onHotChange?.(hot);
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
    if (!this.hot) return;
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
        this.publishLiveScore();
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
    // A fault fails the attempt there and then, rather than when the phrase runs out.
    if (missed.length > 0) {
      this.finishRhythmPhrase();
      return;
    }

    switch (result.kind) {
      case "correct": {
        const state: NoteState =
          session.wrongAt(result.index) > 0 ? "wrong" : result.timing === "on-time" ? "correct" : "late";
        this.setPressedState(session.notes, result.index, state);
        keyboard.flash(pitch, result.timing === "on-time" ? "correct" : "hint");
        if (this.showsHoldGuide(session)) {
          keyboard.setGuide?.(pitch, true);
          this.guides.set(pitch, session.noteEndAt(result.index));
        }
        this.publishLiveScore();
        // The last note still has to be held, so the attempt runs on to the barline (see scheduleTick).
        if (!result.completed && !session.isCountingIn(this.now())) {
          notation.setState(session.currentIndex, "current");
        }
        break;
      }
      case "wrong":
        notation.flashWrong(result.index);
        keyboard.flash(pitch, "wrong");
        keyboard.flash(result.expectedPitch, "hint");
        this.finishRhythmPhrase();
        break;
      case "early":
        notation.flashWrong(result.index);
        keyboard.flash(pitch, "wrong");
        this.finishRhythmPhrase();
        break;
      case "ignored":
        break;
    }
  }

  /** A key let go: let go too soon marks its note, and fails the attempt when holds are strict. */
  private handleRhythmNoteOff(pitch: number, time: number): void {
    const session = this.rhythmSession;
    if (!session || this.finishingRhythm || !this.hot) return;
    const released = session.release(pitch, time);
    if (!released) return;
    if (!released.short) {
      this.deps.notation.setHold?.(released.index, null);
      return;
    }
    this.markHold(session, released.index, time, "short");
    this.publishLiveScore();
    if (this.holdsFail(session)) this.finishRhythmPhrase();
  }

  /** Holds count and are off more often than a phrase forgives. */
  private holdsFail(session: RhythmSession): boolean {
    return session.holdPolicy.fails && session.holdFaults > FORGIVEN_HOLD_FAULTS;
  }

  /** The hold guide shows while holds are coached, never while they're graded strictly. */
  private showsHoldGuide(session: RhythmSession): boolean {
    return this.holdGuide && !session.holdPolicy.fails;
  }

  /** Quarter beats from the first note's onset to `time`. */
  private beatAt(session: RhythmSession, time: number): number {
    return (time - (session.phraseStart ?? 0)) / beatMs(session.tempo);
  }

  /** Leaves a note's hold on the staff: from its press to `until` (its release, or when it was flagged). */
  private markHold(session: RhythmSession, index: number, until: number, state: HoldMark["state"]): void {
    const pressed = session.results()[index].offsetMs ?? 0;
    this.deps.notation.setHold?.(index, {
      from: this.beatAt(session, (session.phraseStart ?? 0) + session.onsets[index] + pressed),
      to: this.beatAt(session, until),
      until: this.beatAt(session, session.noteEndAt(index)),
      state,
    });
  }

  /** Grows the trails of held notes and puts out guide keys whose note has run its length. */
  private followHolds(session: RhythmSession, now: number): void {
    for (const [pitch, endsAt] of this.guides) {
      if (now < endsAt) continue;
      this.deps.keyboard.setGuide?.(pitch, false);
      this.guides.delete(pitch);
    }
    if (!this.showsHoldGuide(session)) return;
    for (const { index, pressedAt, endsAt } of session.holding()) {
      this.deps.notation.setHold?.(index, {
        from: this.beatAt(session, pressedAt),
        to: this.beatAt(session, now),
        until: this.beatAt(session, endsAt),
        state: "live",
      });
    }
  }

  private clearGuides(): void {
    for (const pitch of this.guides.keys()) this.deps.keyboard.setGuide?.(pitch, false);
    this.guides.clear();
  }

  /** Colours a pressed note and the notes tied on from it. */
  private setPressedState(notes: Exercise["bars"][number], index: number, state: NoteState): void {
    for (const i of [index, ...tiedOn(notes, index)]) this.deps.notation.setState(i, state);
  }

  private scheduleTick(): void {
    clearTimeout(this.tickTimer);
    const session = this.rhythmSession;
    if (!session) return;

    this.tickTimer = setTimeout(() => {
      const now = this.now();
      const { missed, currentIndex, completed } = session.tick(now);
      this.applyMisses(missed);
      if (missed.length > 0) {
        this.finishRhythmPhrase();
        return;
      }
      const overheld = session.overheld(now);
      for (const index of overheld) this.markHold(session, index, now, "long");
      if (overheld.length > 0) this.publishLiveScore();
      if (overheld.length > 0 && this.holdsFail(session)) {
        this.finishRhythmPhrase();
        return;
      }
      this.followHolds(session, now);
      // Every note played: the attempt ends at the barline, with the last bar clicked through.
      if (completed && now >= (session.endAt ?? now)) {
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
    const { passed, next } = this.settleAttempt("wait", session.results());
    clearTimeout(this.nextExerciseTimer);
    // A failure goes cold with its marks left up until the player goes hot again.
    if (!passed || this.pauseAfterPass) {
      this.setHot(false);
      return;
    }
    this.nextExerciseTimer = setTimeout(
      () => (next === "new" ? this.startNewExercise(true) : this.beginCurrentExercise(true)),
      PHRASE_SCORE_DELAY_MS,
    );
  }

  private finishRhythmPhrase(): void {
    if (this.finishingRhythm) return;
    this.finishingRhythm = true;
    clearTimeout(this.tickTimer);
    this.tickTimer = undefined;
    this.publishLiveScore();

    const session = this.rhythmSession;
    if (!session) return;
    this.clearGuides();
    // Notes still down at the end were held long enough; their live trails go.
    for (const { index } of session.holding()) this.deps.notation.setHold?.(index, null);
    const { passed, next } = this.settleAttempt("rhythm", session.results(), session.tempo, false, this.holdsOf(session));
    if (!passed || this.pauseAfterPass) {
      this.teardownRhythm(true);
      this.setHot(false);
      return;
    }
    // After a pass the metronome runs on through the end of the bar; a new phrase
    // counts in from the barline, and a second run rests a beat first.
    const phraseEnd = session.endAt ?? this.now();
    const countInAt = next === "new" ? phraseEnd : phraseEnd + beatMs(this.tempo);
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
  private settleAttempt(
    mode: PhraseResult["mode"],
    notes: NoteResult[],
    tempo?: number,
    abandoned = false,
    holds?: HoldStrictness,
  ): PhraseResult {
    const passed = !faultyNotes(notes, holds).includes(true);
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
    this.pendingNew = next === "new";
    if (passed) notes.forEach((_, i) => this.deps.notation.setState(i, "correct"));

    const result: PhraseResult = {
      exercise: this.currentExercise,
      mode,
      tempo,
      holds,
      notes,
      sources: [...this.phraseSources],
      playedMs: this.phraseStartedAt === undefined ? 0 : Math.max(0, this.now() - this.phraseStartedAt),
      passed,
      abandoned,
      slowed,
      next,
      passesNeeded,
    };
    this.deps.onPhraseComplete?.(result);
    this.publishRetry();
    return result;
  }

  private holdsOf(session: RhythmSession): HoldStrictness {
    return session.holdPolicy.fails ? "strict" : "coach";
  }

  private teardownRhythm(stopMetronome: boolean): void {
    this.clearGuides();
    clearTimeout(this.tickTimer);
    this.tickTimer = undefined;
    if (stopMetronome) this.metronome?.stop();
    this.rhythmSession = null;
  }

  private notationOptions(): NotationOptions {
    return { showNames: this.settings.namesOnNotes };
  }
}
