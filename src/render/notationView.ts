import {
  Accidental,
  Annotation,
  AnnotationVerticalJustify,
  BarlineType,
  Formatter,
  Renderer,
  Stave,
  StaveNote,
} from "vexflow/bravura";
import { accidentalsForBar } from "../music/accidentals";
import { noteName } from "../music/pitch";
import type { Exercise, NamingConvention, Note } from "../music/types";

export type NoteState = "pending" | "current" | "correct" | "wrong";

export interface NotationOptions {
  showNames: boolean;
  convention: NamingConvention;
}

const COLORS: Record<NoteState, string> = {
  pending: "#1a2330",
  current: "#0f6e6a",
  correct: "#2f9b6a",
  wrong: "#d45b5b",
};

// Layout in VexFlow units (before scaling to the screen).
const MARGIN = 10;
const BAR_WIDTH = 170;
const CLEF_AND_TIME_WIDTH = 70;
const ROW_HEIGHT = 130;
const MAX_SCALE = 2.2;
const MIN_COMFORTABLE_SCALE = 0.85;
const WRONG_FLASH_MS = 500;

interface Layout {
  barsPerRow: number;
  rows: number;
  scale: number;
}

export class NotationView {
  private exercise: Exercise | null = null;
  private states: NoteState[] = [];
  private options: NotationOptions = { showNames: false, convention: "english" };
  private wrongFlashTimer: number | undefined;

  constructor(private readonly root: HTMLElement) {}

  show(exercise: Exercise, options: NotationOptions): void {
    clearTimeout(this.wrongFlashTimer);
    this.exercise = exercise;
    this.states = exercise.bars.flat().map(() => "pending");
    this.options = options;
    this.draw();
  }

  setOptions(options: NotationOptions): void {
    this.options = options;
    this.draw();
  }

  setState(index: number, state: NoteState): void {
    if (index >= this.states.length) return;
    this.states[index] = state;
    this.draw();
  }

  flashWrong(index: number): void {
    clearTimeout(this.wrongFlashTimer);
    this.setState(index, "wrong");
    this.wrongFlashTimer = window.setTimeout(() => {
      if (this.states[index] === "wrong") this.setState(index, "current");
    }, WRONG_FLASH_MS);
  }

  /** Redraws from scratch; cheap enough for 1–4 bars, and keeps colouring simple. */
  draw(): void {
    this.root.replaceChildren();
    const exercise = this.exercise;
    if (!exercise) return;

    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    const { barsPerRow, rows, scale } = chooseLayout(exercise.bars.length, width, height);

    const renderer = new Renderer(this.root as HTMLDivElement, Renderer.Backends.SVG);
    renderer.resize(width, height);
    const context = renderer.getContext();
    context.scale(scale, scale);

    const rowWidth = rowWidthFor(barsPerRow);
    const offsetX = (width / scale - rowWidth) / 2;
    const offsetY = (height / scale - rows * ROW_HEIGHT) / 2;
    const lastBar = exercise.bars.length - 1;
    let noteIndex = 0;

    exercise.bars.forEach((bar, barIndex) => {
      const row = Math.floor(barIndex / barsPerRow);
      const column = barIndex % barsPerRow;
      const startsRow = column === 0;
      const x = offsetX + MARGIN + (startsRow ? 0 : CLEF_AND_TIME_WIDTH + column * BAR_WIDTH);
      const staveWidth = BAR_WIDTH + (startsRow ? CLEF_AND_TIME_WIDTH : 0);

      const stave = new Stave(x, offsetY + row * ROW_HEIGHT, staveWidth);
      if (startsRow) stave.addClef(exercise.clef);
      if (barIndex === 0) stave.addTimeSignature(`${exercise.beatsPerBar}/4`);
      if (barIndex === lastBar) stave.setEndBarType(BarlineType.END);
      stave.setContext(context).draw();

      const accidentals = accidentalsForBar(bar);
      const staveNotes = bar.map((note, i) =>
        this.buildStaveNote(note, accidentals[i], this.states[noteIndex++], exercise.clef),
      );
      Formatter.FormatAndDraw(context, stave, staveNotes);
    });
  }

  private buildStaveNote(
    note: Note,
    accidental: string | null,
    state: NoteState,
    clef: string,
  ): StaveNote {
    const staveNote = new StaveNote({
      keys: [`${note.letter.toLowerCase()}/${note.octave}`],
      duration: note.duration,
      clef,
      autoStem: true,
    });
    if (accidental) staveNote.addModifier(new Accidental(accidental), 0);
    if (this.options.showNames) {
      const name = new Annotation(noteName(note, this.options.convention));
      name.setVerticalJustification(AnnotationVerticalJustify.BOTTOM);
      staveNote.addModifier(name, 0);
    }
    const color = COLORS[state];
    staveNote.setStyle({ fillStyle: color, strokeStyle: color });
    return staveNote;
  }
}

function rowWidthFor(barsPerRow: number): number {
  return 2 * MARGIN + CLEF_AND_TIME_WIDTH + barsPerRow * BAR_WIDTH;
}

/**
 * Prefer as few rows as possible; wrap only when a line would have to shrink
 * below a comfortable size (e.g. 4 bars on a phone become 2 + 2).
 */
function chooseLayout(barCount: number, width: number, height: number): Layout {
  const candidates: Layout[] = [];
  for (let barsPerRow = barCount; barsPerRow >= 1; barsPerRow--) {
    const rows = Math.ceil(barCount / barsPerRow);
    const scale = Math.min(
      width / rowWidthFor(barsPerRow),
      height / (rows * ROW_HEIGHT),
      MAX_SCALE,
    );
    candidates.push({ barsPerRow, rows, scale });
  }
  return (
    candidates.find((layout) => layout.scale >= MIN_COMFORTABLE_SCALE) ??
    candidates.reduce((best, layout) => (layout.scale > best.scale ? layout : best))
  );
}
