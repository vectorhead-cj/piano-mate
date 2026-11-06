import { OpenSheetMusicDisplay, type GraphicalNote } from "opensheetmusicdisplay";
import { spellInKey } from "../music/accidentals";
import { inScale, KEYS, MINOR_KEYS, type KeyInfo } from "../music/keys";
import { staffStep } from "../music/pitch";
import { KeySpeaker, type KeyScaleHandlers } from "../render/keySpeaker";
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

const SVG_NS = "http://www.w3.org/2000/svg";
const RELEASE_FADE_MS = 150;
/** Played notes further out than this many ledger lines aren't marked. */
const MAX_LEDGERS = 4;
/** The note each clef sign sits on: G4, F3, C4. */
const CLEF_NOTES: Record<string, { letter: "G" | "F" | "C"; octave: number }> = {
  G: { letter: "G", octave: 4 },
  F: { letter: "F", octave: 3 },
  C: { letter: "C", octave: 4 },
};

/** Staff step of a clef's bottom line, from its sign and line ("G2" → E4, "F4" → G2). */
function bottomLineStep(clef: string): number {
  const note = CLEF_NOTES[clef[0]] ?? CLEF_NOTES.G;
  const line = Number(clef.slice(1)) || 2;
  return staffStep({ ...note, alter: 0 }) - 2 * (line - 1);
}

function keyOf(fifths: number, mode: "major" | "minor"): KeyInfo {
  return (mode === "minor" ? MINOR_KEYS : KEYS).find((k) => k.signature === fifths) ?? KEYS[0];
}

/** A staff as drawn in one bar, in CSS pixels from the top left of the score. */
interface StaffBox {
  measure: number;
  staff: number;
  left: number;
  right: number;
  /** The bottom line. */
  bottom: number;
}

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
  private staffBoxes: StaffBox[] = [];
  /** Played keys show as lit staff lines and spaces, behind the music; only in free play. */
  private readonly playedLayer = document.createElementNS(SVG_NS, "svg");
  private highlightPlayed = false;
  private freePlay = true;
  private readonly held = new Set<number>();
  private readonly fading = new Map<number, number>();
  private piece: Piece | null = null;
  private keySpeaker: KeySpeaker | null = null;
  private firstMeasure = 0;
  private colors = readColors();
  private width = 0;
  private generation = 0;
  /** Phrases shaded in turn and numbered, with bars being picked out over them. */
  private bands: { from: number; to: number }[] = [];
  private selection: { from: number; to: number } | null = null;
  /** The bar being played. */
  private cursor: number | null = null;

  /**
   * `zoom` fixes the size, for small examples; otherwise it follows the width. `compact` draws
   * with the tight margins of the curriculum's staff, as a fixed zoom does.
   */
  constructor(
    private readonly root: HTMLElement,
    private readonly zoom?: number,
    compact = zoom !== undefined,
  ) {
    this.sheet.className = "piece-sheet";
    this.overlay.className = "piece-overlay";
    this.overlay.setAttribute("aria-hidden", "true");
    this.playedLayer.setAttribute("class", "piece-played");
    this.playedLayer.setAttribute("aria-hidden", "true");
    root.replaceChildren(this.playedLayer, this.sheet, this.overlay);
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
      ...(compact && { drawingParameters: "compacttight" }),
    });
    if (compact && zoom === undefined) {
      // As the curriculum's staff: room kept for ledger lines (C4 below the staff).
      const rules = this.osmd.EngravingRules;
      rules.PageBottomMargin = Math.max(rules.PageBottomMargin, 2.5);
      rules.PageTopMargin = Math.max(rules.PageTopMargin, 1.5);
      rules.PageTopMarginNarrow = Math.max(rules.PageTopMarginNarrow, 1.5);
    } else if (zoom !== undefined) {
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

  /** Toggle lighting the staff for played keys. */
  setHighlightPlayed(on: boolean): void {
    if (on === this.highlightPlayed) return;
    this.highlightPlayed = on;
    this.drawPlayed();
  }

  /** Played keys light the staff only while no pass is being graded. */
  setFreePlay(on: boolean): void {
    if (on === this.freePlay) return;
    this.freePlay = on;
    this.drawPlayed();
  }

  setPlayed(pitch: number, down: boolean): void {
    clearTimeout(this.fading.get(pitch));
    this.fading.delete(pitch);
    if (down) this.held.add(pitch);
    else if (this.held.delete(pitch)) {
      this.fading.set(
        pitch,
        window.setTimeout(() => {
          this.fading.delete(pitch);
          this.drawPlayed();
        }, RELEASE_FADE_MS),
      );
    }
    this.drawPlayed();
  }

  /**
   * Adds a speaker button over the first key signature drawn. It plays the minor key if the
   * piece says so, otherwise major, as of the first bar drawn.
   */
  setKeyScale(handlers: KeyScaleHandlers): void {
    this.keySpeaker = new KeySpeaker(this.root, handlers);
    this.placeKeySpeaker();
  }

  private placeKeySpeaker(): void {
    const info = this.piece?.measures[this.firstMeasure];
    if (info) this.keySpeaker?.place(keyOf(info.fifths, info.mode));
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
    this.drawPlayed();
    this.placeKeySpeaker();
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
    this.staffBoxes = [];
    this.osmd.GraphicSheet.MeasureList.forEach((staves, j) => {
      const measure = this.firstMeasure + j;
      staves.forEach((graphical, staff) => {
        if (!graphical) return;
        const shape = graphical.PositionAndShape;
        this.staffBoxes.push({
          measure,
          staff,
          left: (shape.AbsolutePosition.x + shape.BorderLeft) * unit,
          right: (shape.AbsolutePosition.x + shape.BorderRight) * unit,
          bottom: (shape.AbsolutePosition.y + 4) * unit,
        });
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

  /** Each played key as a thickened line or tinted space across the bars: yellow in the bar's scale, red outside it. */
  private drawPlayed(): void {
    const layer = this.playedLayer;
    layer.replaceChildren();
    const piece = this.piece;
    if (!this.highlightPlayed || !this.freePlay || !piece || !this.osmd.Sheet) return;
    const unit = 10 * this.osmd.Zoom;
    const add = (parent: Element, tag: string, attrs: Record<string, string | number>, className: string) => {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
      node.setAttribute("class", className);
      parent.append(node);
    };
    const pitches = [...this.held, ...this.fading.keys()];
    const lowest = -2 * MAX_LEDGERS;
    const highest = 8 + 2 * MAX_LEDGERS;
    const staves = new Map<number, StaffBox[]>();
    for (const box of this.staffBoxes) staves.set(box.measure, [...(staves.get(box.measure) ?? []), box]);
    for (const [measure, boxes] of staves) {
      const info = piece.measures[measure];
      if (!info) continue;
      const key = keyOf(info.fifths, info.mode);
      for (const pitch of pitches) {
        const spelling = spellInKey(pitch, key).spelling;
        // The staff the note sits nearest, the upper one when it's as near to both.
        const places = boxes.map((box) => {
          const position = staffStep(spelling) - bottomLineStep(box.staff === 1 ? info.clefs.left : info.clefs.right);
          return { box, position, distance: Math.max(0, -position, position - 8) };
        });
        const best = places.reduce((a, b) => (b.distance < a.distance ? b : a));
        const { box, position } = best;
        if (position < lowest || position > highest) continue;
        const y = (at: number) => box.bottom - (at * unit) / 2;
        const tone = `${this.held.has(pitch) ? "played-note" : "played-note fading"}${inScale(pitch, key) ? "" : " off-scale"}`;
        const group = document.createElementNS(SVG_NS, "g");
        group.setAttribute("class", tone);
        layer.append(group);
        const span = { x1: box.left, x2: box.right };
        for (let line = -2; line > position; line -= 2) add(group, "line", { ...span, y1: y(line), y2: y(line) }, "played-ledger");
        for (let line = 10; line < position; line += 2) add(group, "line", { ...span, y1: y(line), y2: y(line) }, "played-ledger");
        if (position % 2 === 0) add(group, "line", { ...span, y1: y(position), y2: y(position) }, "played-line");
        else add(group, "rect", { x: box.left, y: y(position) - unit / 2, width: box.right - box.left, height: unit }, "played-space");
      }
    }
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
