import {
  Accidental,
  Annotation,
  AnnotationVerticalJustify,
  BarlineType,
  Beam,
  Formatter,
  Renderer,
  Stave,
  StaveNote,
} from "vexflow/bravura";
import { accidentalsForBar } from "../music/accidentals";
import { keyById } from "../music/keys";
import { noteName } from "../music/pitch";
import type { Exercise, Note } from "../music/types";

export type NoteState = "pending" | "current" | "correct" | "late" | "wrong";

export interface NotationOptions {
  showNames: boolean;
}

/** Keep in sync with --ink / --note-current / --correct / --late / --wrong in styles.css. */
const COLORS: Record<NoteState, string> = {
  pending: "#1a2330",
  current: "#c07828",
  correct: "#2d8a68",
  late: "#c07828",
  wrong: "#c45c5c",
};

// Layout in VexFlow units (before scaling to the screen).
const MARGIN = 10;
const BAR_WIDTH = 170;
const CLEF_WIDTH = 40;
const TIME_WIDTH = 30;
const ACCIDENTAL_WIDTH = 10;
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
  private options: NotationOptions = { showNames: false };
  private wrongFlashTimer: number | undefined;
  private drawHandle = 0;

  constructor(private readonly root: HTMLElement) {}

  show(exercise: Exercise, options: NotationOptions): void {
    clearTimeout(this.wrongFlashTimer);
    this.exercise = exercise;
    this.states = exercise.bars.flat().map(() => "pending");
    this.options = options;
    this.drawNow();
  }

  setOptions(options: NotationOptions): void {
    this.options = options;
    this.scheduleDraw();
  }

  setState(index: number, state: NoteState): void {
    if (index >= this.states.length) return;
    this.states[index] = state;
    this.scheduleDraw();
  }

  /** Coalesce rapid setState calls (note + current highlight) into one frame. */
  private scheduleDraw(): void {
    if (this.drawHandle) return;
    this.drawHandle = requestAnimationFrame(() => {
      this.drawHandle = 0;
      this.drawNow();
    });
  }

  private drawNow(): void {
    if (this.drawHandle) {
      cancelAnimationFrame(this.drawHandle);
      this.drawHandle = 0;
    }
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

    const key = keyById(exercise.key);
    const preface = prefaceWidth(Math.abs(key.signature));
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    const { barsPerRow, rows, scale } = chooseLayout(exercise.bars.length, preface, width, height);

    const renderer = new Renderer(this.root as HTMLDivElement, Renderer.Backends.SVG);
    renderer.resize(width, height);
    const context = renderer.getContext();
    context.scale(scale, scale);

    const rowWidth = rowWidthFor(barsPerRow, preface);
    const offsetX = (width / scale - rowWidth) / 2;
    const offsetY = (height / scale - rows * ROW_HEIGHT) / 2;
    const lastBar = exercise.bars.length - 1;
    let noteIndex = 0;

    exercise.bars.forEach((bar, barIndex) => {
      const row = Math.floor(barIndex / barsPerRow);
      const column = barIndex % barsPerRow;
      const startsRow = column === 0;
      const x = offsetX + MARGIN + (startsRow ? 0 : preface + column * BAR_WIDTH);
      const staveWidth = BAR_WIDTH + (startsRow ? preface : 0);

      const stave = new Stave(x, offsetY + row * ROW_HEIGHT, staveWidth);
      if (startsRow) {
        stave.addClef(exercise.clef);
        stave.addKeySignature(exercise.key);
      }
      if (barIndex === 0) stave.addTimeSignature(`${exercise.beatsPerBar}/4`);
      if (barIndex === lastBar) stave.setEndBarType(BarlineType.END);
      stave.setContext(context).draw();

      const accidentals = accidentalsForBar(bar, key);
      const staveNotes = bar.map((note, i) =>
        this.buildStaveNote(note, accidentals[i], this.states[noteIndex++], exercise.clef),
      );
      Formatter.FormatAndDraw(context, stave, staveNotes);
      for (const beam of Beam.generateBeams(staveNotes)) {
        beam.setContext(context).draw();
      }
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
      const name = new Annotation(noteName(note));
      name.setVerticalJustification(AnnotationVerticalJustify.BOTTOM);
      staveNote.addModifier(name, 0);
    }
    const color = COLORS[state];
    staveNote.setStyle({ fillStyle: color, strokeStyle: color });
    return staveNote;
  }
}

function prefaceWidth(accidentalCount: number): number {
  return CLEF_WIDTH + TIME_WIDTH + accidentalCount * ACCIDENTAL_WIDTH;
}

function rowWidthFor(barsPerRow: number, preface: number): number {
  return 2 * MARGIN + preface + barsPerRow * BAR_WIDTH;
}

/**
 * Prefer as few rows as possible; wrap only when a line would have to shrink
 * below a comfortable size (e.g. 4 bars on a phone become 2 + 2).
 */
function chooseLayout(barCount: number, preface: number, width: number, height: number): Layout {
  const candidates: Layout[] = [];
  for (let barsPerRow = barCount; barsPerRow >= 1; barsPerRow--) {
    const rows = Math.ceil(barCount / barsPerRow);
    const scale = Math.min(
      width / rowWidthFor(barsPerRow, preface),
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
