import { OpenSheetMusicDisplay, type GraphicalNote } from "opensheetmusicdisplay";
import type { Hand, Piece } from "./piece";

export type NoteMark = "pending" | "current" | "correct" | "late" | "wrong";

/** Note colors come from styles.css tokens, so they follow the light/dark theme. */
const COLOR_TOKENS: Record<NoteMark, string> = {
  pending: "--ink",
  current: "--note-current",
  correct: "--correct",
  late: "--late",
  wrong: "--wrong",
};

const COLOR_OPTS = {
  applyToNoteheads: true,
  applyToStem: true,
  applyToFlag: true,
  applyToLedgerLines: true,
  applyToModifiers: true,
} as const;

/** OSMD counts semitones from C0 an octave lower than MIDI does. */
const HALFTONE_TO_MIDI = 12;
/** Staff spaces above the top staff and below the bottom one that still count as the bar, for taps. */
const BAR_PAD_UNITS = 3;
/** Notes look about this big at zoom 1 on a laptop; phones and tablets scale with their width. */
const BASE_WIDTH_PX = 1000;

function readColors(): Record<NoteMark, string> {
  const style = getComputedStyle(document.documentElement);
  const colors = {} as Record<NoteMark, string>;
  for (const [mark, token] of Object.entries(COLOR_TOKENS) as [NoteMark, string][]) colors[mark] = style.getPropertyValue(token).trim();
  return colors;
}

/** A bar's place on the drawn page, in CSS pixels from the top left of the score. */
export interface BarBox {
  measure: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A piece, or some of its bars, drawn by OSMD at the width it's given, notes coloured as
 * they're played. Notes are found by bar, hand, place in the bar and pitch, so the drawing
 * and the grading come from the same file without sharing OSMD's model.
 */
export class PieceScoreView {
  private readonly osmd: OpenSheetMusicDisplay;
  private readonly sheet = document.createElement("div");
  private readonly overlay = document.createElement("div");
  /** Drawn notes by Piece.notes index. */
  private drawn = new Map<number, GraphicalNote[]>();
  private boxes: BarBox[] = [];
  private piece: Piece | null = null;
  private firstMeasure = 0;
  private colors = readColors();
  private width = 0;
  private generation = 0;
  /** Phrases shaded in turn and numbered, with bars being picked out over them. */
  private bands: { from: number; to: number }[] = [];
  private selection: { from: number; to: number } | null = null;
  /** The bar being played. */
  private cursor: number | null = null;

  /** `zoom` fixes the size, for small examples; otherwise it follows the width. */
  constructor(
    private readonly root: HTMLElement,
    private readonly zoom?: number,
  ) {
    this.sheet.className = "piece-sheet";
    this.overlay.className = "piece-overlay";
    this.overlay.setAttribute("aria-hidden", "true");
    root.replaceChildren(this.sheet, this.overlay);
    this.osmd = new OpenSheetMusicDisplay(this.sheet, {
      backend: "svg",
      autoResize: false,
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawCredits: false,
      drawPartNames: false,
      drawMeasureNumbers: true,
      disableCursor: true,
      defaultColorMusic: this.colors.pending,
      ...(zoom !== undefined && { drawingParameters: "compacttight" }),
    });
    if (zoom !== undefined) {
      // A small example sits snug in its card: just room for ledger lines and the bar numbers.
      const rules = this.osmd.EngravingRules;
      rules.PageTopMargin = 1;
      rules.PageTopMarginNarrow = 1;
      rules.PageBottomMargin = 1;
      rules.PageLeftMargin = 0.5;
      rules.PageRightMargin = 0.5;
    }
  }

  /** Draws the score's fingering numbers or leaves them out, laying the music out again if it's drawn. */
  setFingerings(on: boolean): void {
    if (this.osmd.EngravingRules.RenderFingerings === on) return;
    this.osmd.EngravingRules.RenderFingerings = on;
    if (!this.osmd.Sheet) return;
    // A render keeps the fingerings it placed before; a new graphic sheet starts without them.
    this.osmd.updateGraphic();
    this.width = 0;
    this.draw();
  }

  /** Draws `xml` (a whole piece, or the bars from `firstMeasure` on) and forgets earlier colours. */
  async show(xml: string, piece: Piece, firstMeasure = 0): Promise<void> {
    const generation = ++this.generation;
    this.piece = piece;
    this.firstMeasure = firstMeasure;
    this.colors = readColors();
    this.osmd.EngravingRules.applyDefaultColorMusic(this.colors.pending);
    await this.osmd.load(xml);
    if (generation !== this.generation) return;
    this.width = 0;
    this.draw();
  }

  /** Lays the music out again if the width changed; colours are kept. */
  draw(): void {
    if (!this.piece || !this.osmd.Sheet) return;
    const width = this.root.clientWidth;
    if (width === 0 || width === this.width) return;
    this.width = width;
    this.osmd.Zoom = this.zoom ?? Math.min(1.15, Math.max(0.6, width / BASE_WIDTH_PX));
    this.osmd.render();
    this.collect();
    this.drawMarks();
  }

  setMark(noteIndices: readonly number[], mark: NoteMark): void {
    for (const index of noteIndices) for (const note of this.drawn.get(index) ?? []) note.setColor(this.colors[mark], COLOR_OPTS);
  }

  clearMarks(): void {
    for (const notes of this.drawn.values()) for (const note of notes) note.setColor(this.colors.pending, COLOR_OPTS);
  }

  /** Shades each phrase's bars, alternating, with its number at its start. */
  setBands(bands: readonly { from: number; to: number }[]): void {
    this.bands = [...bands];
    this.drawMarks();
  }

  /** Bars being picked out, as a drag across them goes; null clears them. */
  setSelection(selection: { from: number; to: number } | null): void {
    this.selection = selection && { from: Math.min(selection.from, selection.to), to: Math.max(selection.from, selection.to) };
    this.drawMarks();
  }

  /** Washes the bar being played; null clears it. */
  setCursor(measure: number | null): void {
    if (measure === this.cursor) return;
    this.cursor = measure;
    this.drawMarks();
  }

  /** The bar under a point on the screen, as a measure index. */
  barAt(clientX: number, clientY: number): number | null {
    const origin = this.sheet.getBoundingClientRect();
    const x = clientX - origin.left;
    const y = clientY - origin.top;
    const hit = this.boxes.find((b) => x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height);
    return hit?.measure ?? null;
  }

  barBox(measure: number): BarBox | undefined {
    return this.boxes.find((b) => b.measure === measure);
  }

  /** Scrolls the score's scroller so the bar's line is in view, a little below the top. */
  scrollToBar(measure: number, scroller: HTMLElement): void {
    const box = this.barBox(measure);
    if (!box) return;
    const sheetTop = this.sheet.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const top = sheetTop + box.top - 12;
    const visible = top >= scroller.scrollTop && top + box.height <= scroller.scrollTop + scroller.clientHeight;
    if (!visible) scroller.scrollTo({ top, behavior: "smooth" });
  }

  private collect(): void {
    const piece = this.piece!;
    const unit = 10 * this.osmd.Zoom;
    const byKey = new Map<string, number>();
    // Grace notes share their main note's time, so they're told apart by being grace notes.
    piece.notes.forEach((note, i) => byKey.set(`${note.grace ? "g" : ""}${note.measure}|${note.hand}|${note.offset}|${note.midi}`, i));
    this.drawn = new Map();
    this.boxes = [];
    this.osmd.GraphicSheet.MeasureList.forEach((staves, j) => {
      const measure = this.firstMeasure + j;
      staves.forEach((graphical, staff) => {
        if (!graphical) return;
        const hand: Hand = staff === 1 ? "left" : "right";
        for (const entry of graphical.staffEntries) {
          const offset = Math.round(entry.relInMeasureTimestamp.RealValue * 4 * 9600) / 9600;
          for (const voice of entry.graphicalVoiceEntries) {
            const grace = voice.parentVoiceEntry.IsGrace ? "g" : "";
            for (const note of voice.notes) {
              if (note.sourceNote.isRest()) continue;
              const index = byKey.get(`${grace}${measure}|${hand}|${offset}|${note.sourceNote.halfTone + HALFTONE_TO_MIDI}`);
              if (index === undefined) continue;
              this.drawn.set(index, [...(this.drawn.get(index) ?? []), note]);
            }
          }
        }
      });
      const top = staves[0];
      const bottom = staves[staves.length - 1];
      if (!top || !bottom) return;
      const left = (top.PositionAndShape.AbsolutePosition.x + top.PositionAndShape.BorderLeft) * unit;
      const right = (top.PositionAndShape.AbsolutePosition.x + top.PositionAndShape.BorderRight) * unit;
      const y0 = (top.PositionAndShape.AbsolutePosition.y - BAR_PAD_UNITS) * unit;
      const y1 = (bottom.PositionAndShape.AbsolutePosition.y + 4 + BAR_PAD_UNITS) * unit;
      this.boxes.push({ measure, left, top: y0, width: right - left, height: y1 - y0 });
    });
  }

  private drawMarks(): void {
    this.overlay.replaceChildren();
    const place = (className: string, box: BarBox) => {
      const node = document.createElement("div");
      node.className = className;
      Object.assign(node.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
      this.overlay.append(node);
      return node;
    };
    const within = (range: { from: number; to: number } | null, measure: number) => range !== null && measure >= range.from && measure <= range.to;
    for (const box of this.boxes) {
      const band = this.bands.findIndex((b) => within(b, box.measure));
      if (band >= 0) {
        const shade = place(`piece-band piece-band-${band % 2 ? "odd" : "even"}`, box);
        // The number sits at the phrase's first bar, and again where it carries on to a new line.
        const lineStart = this.boxes.find((b) => b.measure === box.measure - 1)?.top !== box.top;
        if (box.measure === this.bands[band].from || lineStart) {
          shade.append(Object.assign(document.createElement("span"), { className: "piece-band-label", textContent: String(band + 1) }));
        }
      }
      if (within(this.selection, box.measure)) place("piece-bar-selected", box);
      if (box.measure === this.cursor) place("piece-bar-active", box);
    }
  }
}
