import type { NoteStream } from "../input/noteStream";
import { generateExercise, type Random } from "../music/generator";
import type { Exercise, Level } from "../music/types";
import type { KeyFlash } from "../render/keyboardView";
import type { NotationOptions, NoteState } from "../render/notationView";
import { exactPitch } from "./matcher";
import type { Settings } from "./settings";
import { WaitSession } from "./waitSession";

export const NEXT_EXERCISE_DELAY_MS = 700;

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
  setLabels(visible: boolean): void;
}

export interface SoundOutput {
  play(pitch: number, velocity?: number): void;
}

export interface PracticeDependencies {
  stream: NoteStream;
  notation: NotationDisplay;
  keyboard: KeyboardDisplay;
  sound: SoundOutput;
  level: Level;
  settings: Settings;
  random?: Random;
}

/** Wait-mode practice: note events in, feedback to the views out. */
export class PracticeController {
  private settings: Settings;
  private session!: WaitSession;
  private currentExercise!: Exercise;
  private nextExerciseTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: PracticeDependencies) {
    this.settings = deps.settings;
    deps.stream.subscribe((event) => {
      deps.keyboard.setPressed(event.pitch, event.kind === "on");
      if (event.kind === "on") {
        deps.sound.play(event.pitch, event.velocity);
        this.handleNoteOn(event.pitch);
      }
    });
    deps.keyboard.setLabels(this.settings.namesOnKeys);
    this.startNewExercise();
  }

  get exercise(): Exercise {
    return this.currentExercise;
  }

  startNewExercise(): void {
    clearTimeout(this.nextExerciseTimer);
    this.currentExercise = generateExercise(
      this.deps.level,
      {
        bars: this.settings.bars,
        key: this.settings.key,
        accidentalFrequency: this.settings.accidentalFrequency,
      },
      this.deps.random,
    );
    this.session = new WaitSession(this.currentExercise, exactPitch);
    this.deps.notation.show(this.currentExercise, this.notationOptions());
    this.deps.notation.setState(0, "current");
  }

  updateSettings(settings: Settings, changed: keyof Settings): void {
    this.settings = settings;
    this.deps.keyboard.setLabels(settings.namesOnKeys);
    if (changed === "bars" || changed === "key" || changed === "accidentalFrequency") {
      this.startNewExercise();
    } else {
      this.deps.notation.setOptions(this.notationOptions());
    }
  }

  private handleNoteOn(pitch: number): void {
    const { notation, keyboard } = this.deps;
    const result = this.session.play(pitch);
    switch (result.kind) {
      case "correct":
        notation.setState(result.index, "correct");
        keyboard.flash(pitch, "correct");
        if (result.completed) {
          this.nextExerciseTimer = setTimeout(
            () => this.startNewExercise(),
            NEXT_EXERCISE_DELAY_MS,
          );
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

  private notationOptions(): NotationOptions {
    return { showNames: this.settings.namesOnNotes };
  }
}
