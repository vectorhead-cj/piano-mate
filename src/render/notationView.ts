import { OpenSheetMusicDisplay, type GraphicalNote } from "opensheetmusicdisplay";
import { exerciseToMusicXml } from "../music/musicXml";
import type { Exercise } from "../music/types";

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

const COLOR_OPTS = {
  applyToNoteheads: true,
  applyToStem: true,
  applyToFlag: true,
  applyToLedgerLines: true,
  applyToModifiers: true,
  applyToLyrics: true,
} as const;

const WRONG_FLASH_MS = 500;
/** OSMD lays out at containerWidth/zoom then scales — higher zoom = bigger notes. */
const MAX_ZOOM = 2.8;
const FIT_PADDING_PX = 24;

/**
 * Renders phrases via MusicXML → OpenSheetMusicDisplay (standard web engraving stack).
 * Note states are applied with GraphicalNote.setColor without a full re-render.
 */
export class NotationView {
  private readonly root: HTMLElement;
  private readonly osmd: OpenSheetMusicDisplay;
  private exercise: Exercise | null = null;
  private states: NoteState[] = [];
  private options: NotationOptions = { showNames: false };
  private graphicalNotes: GraphicalNote[] = [];
  private wrongFlashTimer: number | undefined;
  private renderGeneration = 0;
  private ready = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.osmd = new OpenSheetMusicDisplay(root, {
      backend: "svg",
      autoResize: false,
      autoBeam: true,
      drawingParameters: "compacttight",
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawCredits: false,
      drawPartNames: false,
      drawMeasureNumbers: false,
      disableCursor: true,
      defaultColorMusic: COLORS.pending,
    });
    const rules = this.osmd.EngravingRules;
    // Equal bar widths (experimental OSMD option) — steadier grid for practice phrases.
    rules.FixedMeasureWidth = true;
    // compacttight shrinks page margins; keep room for ledger lines (e.g. C4 below the staff).
    rules.PageBottomMargin = Math.max(rules.PageBottomMargin, 2.5);
    rules.PageTopMargin = Math.max(rules.PageTopMargin, 1.5);
    rules.PageTopMarginNarrow = Math.max(rules.PageTopMarginNarrow, 1.5);
  }

  show(exercise: Exercise, options: NotationOptions): void {
    clearTimeout(this.wrongFlashTimer);
    this.exercise = exercise;
    this.states = exercise.bars.flat().map(() => "pending");
    this.options = options;
    void this.reload();
  }

  setOptions(options: NotationOptions): void {
    const namesChanged = options.showNames !== this.options.showNames;
    this.options = options;
    if (namesChanged) void this.reload();
    else this.applyColors();
  }

  setState(index: number, state: NoteState): void {
    if (index >= this.states.length) return;
    this.states[index] = state;
    this.applyColors();
  }

  flashWrong(index: number): void {
    clearTimeout(this.wrongFlashTimer);
    this.setState(index, "wrong");
    this.wrongFlashTimer = window.setTimeout(() => {
      if (this.states[index] === "wrong") this.setState(index, "current");
    }, WRONG_FLASH_MS);
  }

  /** Re-layout after container resize (OSMD autoResize is off so we own this). */
  draw(): void {
    if (!this.ready || !this.exercise) return;
    this.renderFitted();
  }

  private async reload(): Promise<void> {
    const exercise = this.exercise;
    if (!exercise) return;

    const generation = ++this.renderGeneration;
    this.ready = false;
    const xml = exerciseToMusicXml(exercise, { noteNames: this.options.showNames });

    await this.osmd.load(xml);
    if (generation !== this.renderGeneration) return;

    this.renderFitted();
    this.ready = true;
  }

  /**
   * Measure the music at zoom 1, size #notation to that width, zoom to fill the
   * panel, and let `.notation-sheet` flexbox center the result. No SVG cropping.
   */
  private renderFitted(): void {
    const sheet = this.root.parentElement ?? this.root;
    const availW = Math.max(0, sheet.clientWidth - FIT_PADDING_PX * 2);
    const availH = Math.max(0, sheet.clientHeight - FIT_PADDING_PX * 2);

    this.root.style.width = `${Math.max(sheet.clientWidth, 1)}px`;
    this.osmd.Zoom = 1;
    this.osmd.render();

    const size = musicContentSizePx(this.osmd);
    if (!size || availW <= 0 || availH <= 0) {
      this.graphicalNotes = collectGraphicalNotes(this.osmd);
      this.applyColors();
      return;
    }

    // Short phrases fill the panel too aggressively; ease 1–3 bars down a bit.
    const bars = this.exercise?.bars.length ?? 4;
    const shortPhraseScale = bars <= 3 ? 0.8 : 1;
    const zoom =
      Math.min(MAX_ZOOM, availW / size.width, availH / size.height) * shortPhraseScale;
    this.osmd.Zoom = Math.max(zoom, 0.5);
    this.root.style.width = `${Math.min(size.width * this.osmd.Zoom, availW)}px`;
    this.osmd.render();

    this.graphicalNotes = collectGraphicalNotes(this.osmd);
    this.applyColors();
  }

  private applyColors(): void {
    const count = Math.min(this.states.length, this.graphicalNotes.length);
    for (let i = 0; i < count; i++) {
      this.graphicalNotes[i].setColor(COLORS[this.states[i]], COLOR_OPTS);
    }
  }
}

function collectGraphicalNotes(osmd: OpenSheetMusicDisplay): GraphicalNote[] {
  const notes: GraphicalNote[] = [];
  for (const staffMeasures of osmd.GraphicSheet.MeasureList) {
    const measure = staffMeasures[0];
    if (!measure) continue;
    for (const staffEntry of measure.staffEntries) {
      for (const voiceEntry of staffEntry.graphicalVoiceEntries) {
        for (const note of voiceEntry.notes) {
          notes.push(note);
        }
      }
    }
  }
  return notes;
}

/**
 * Inked score bounds from measures and notes (notes catch ledger lines measure
 * boxes often omit). OSMD units are px/10 → CSS pixels at current zoom.
 */
function musicContentSizePx(
  osmd: OpenSheetMusicDisplay,
): { width: number; height: number } | null {
  const measures = osmd.GraphicSheet?.MeasureList;
  if (!measures?.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const include = (box: { AbsolutePosition: { x: number; y: number }; BorderLeft: number; BorderRight: number; BorderTop: number; BorderBottom: number }) => {
    const { x, y } = box.AbsolutePosition;
    minX = Math.min(minX, x + box.BorderLeft);
    maxX = Math.max(maxX, x + box.BorderRight);
    minY = Math.min(minY, y + box.BorderTop);
    maxY = Math.max(maxY, y + box.BorderBottom);
  };

  for (const staffMeasures of measures) {
    const measure = staffMeasures[0];
    if (!measure) continue;
    include(measure.PositionAndShape);
    for (const staffEntry of measure.staffEntries) {
      for (const voiceEntry of staffEntry.graphicalVoiceEntries) {
        for (const note of voiceEntry.notes) {
          include(note.PositionAndShape);
        }
      }
    }
  }

  if (!(maxX > minX) || !(maxY > minY)) return null;

  // Padding for clef/key and ledger-line stroke beyond notehead boxes.
  const scale = 10 * osmd.Zoom;
  return {
    width: (maxX - minX) * scale + 24,
    height: (maxY - minY) * scale + 36,
  };
}
