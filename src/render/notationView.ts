import { OpenSheetMusicDisplay, type GraphicalNote } from "opensheetmusicdisplay";
import { spellInKey, type AccidentalSymbol } from "../music/accidentals";
import { keyById, signatureLetters } from "../music/keys";
import { exerciseToMusicXml } from "../music/musicXml";
import { staffStep } from "../music/pitch";
import type { Clef, Exercise } from "../music/types";

export type NoteState = "pending" | "current" | "correct" | "late" | "wrong";

export interface NotationOptions {
  showNames: boolean;
}

/** Note colors come from these styles.css tokens, so they follow the light/dark theme. */
const COLOR_TOKENS: Record<NoteState, string> = {
  pending: "--ink",
  current: "--note-current",
  correct: "--correct",
  late: "--late",
  wrong: "--wrong",
};

function readThemeColors(): Record<NoteState, string> {
  const style = getComputedStyle(document.documentElement);
  const colors = {} as Record<NoteState, string>;
  for (const [state, token] of Object.entries(COLOR_TOKENS) as [NoteState, string][]) {
    colors[state] = style.getPropertyValue(token).trim();
  }
  return colors;
}

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

/** Staff letters, bottom line upwards, alternating line/space. */
const STAFF_LETTERS: Record<Clef, string[]> = {
  treble: ["E", "F", "G", "A", "B", "C", "D", "E", "F"],
  bass: ["G", "A", "B", "C", "D", "E", "F", "G", "A"],
};
/** Each margin holds two columns (lines nearest the staff, spaces outside), in staff spaces. */
const LETTER_COLUMN_UNITS = 1.3;
const LETTER_GAP_UNITS = 0.6;
const LETTER_GUTTER_UNITS = LETTER_GAP_UNITS + LETTER_COLUMN_UNITS * 2;

/** Staff step of each clef's bottom line (E4, G2), so played notes land on the right line. */
const BOTTOM_LINE_STEP: Record<Clef, number> = {
  treble: staffStep({ letter: "E", alter: 0, octave: 4 }),
  bass: staffStep({ letter: "G", alter: 0, octave: 2 }),
};
/** A short empty bar after the final barline where played notes are written out, in staff spaces. */
const SCRATCH_GAP_UNITS = 1;
const SCRATCH_BAR_UNITS = 6;
const GHOST_GUTTER_UNITS = SCRATCH_GAP_UNITS + SCRATCH_BAR_UNITS;
/** Where the written-out notehead sits in the scratch bar, leaving room for accidentals before it. */
const GHOST_X_UNITS = 3.6;
/** Played notes further out than this many ledger lines get an arrow instead. */
const MAX_LEDGERS = 4;
const RELEASE_FADE_MS = 150;
const SVG_NS = "http://www.w3.org/2000/svg";
/**
 * Accidentals as strokes in staff spaces, centred on the note's line or space (y down):
 * thin uprights, and thick bars or bowl.
 */
const ACCIDENTAL_STROKES: Record<AccidentalSymbol, { thin: string; thick: string }> = {
  "#": { thin: "M-0.22 -1.3 V1.5 M0.22 -1.5 V1.3", thick: "M-0.5 -0.25 L0.5 -0.55 M-0.5 0.55 L0.5 0.25" },
  b: { thin: "M-0.3 -2 V0.55", thick: "M-0.3 0.5 C0.6 -0.05 0.55 -0.75 -0.3 -0.15" },
  n: { thin: "M-0.25 -1.4 V0.55 M0.25 -0.55 V1.4", thick: "M-0.25 -0.2 L0.25 -0.4 M-0.25 0.4 L0.25 0.2" },
};

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
  private colors = readThemeColors();
  private staffLetters = false;
  private readonly lettersLayer = document.createElement("div");
  /** A soft wash behind the bar a phrase went wrong in, from 1; null when none. */
  private markedBar: number | null = null;
  private readonly barMark = document.createElement("div");
  /** Free play only: what's held down, as staff lines/spaces and a note written after the music. */
  private highlightPlayed = false;
  private freePlay = true;
  private readonly held = new Set<number>();
  /** Released keys still fading out, with the timer that removes them. */
  private readonly fading = new Map<number, number>();
  /**
   * Notehead and accidental column of each played key, kept from press to release, so a
   * note pushed aside by a close neighbour doesn't jump when the neighbour is let go.
   */
  private readonly columns = new Map<number, { head: number; sign: number }>();
  private readonly playedLayer = document.createElementNS(SVG_NS, "svg");

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
      defaultColorMusic: this.colors.pending,
    });
    const rules = this.osmd.EngravingRules;
    // Equal bar widths (experimental OSMD option) — steadier grid for practice phrases.
    rules.FixedMeasureWidth = true;
    // compacttight shrinks page margins; keep room for ledger lines (e.g. C4 below the staff).
    rules.PageBottomMargin = Math.max(rules.PageBottomMargin, 2.5);
    rules.PageTopMargin = Math.max(rules.PageTopMargin, 1.5);
    rules.PageTopMarginNarrow = Math.max(rules.PageTopMarginNarrow, 1.5);
    this.lettersLayer.className = "staff-letters";
    this.lettersLayer.setAttribute("aria-hidden", "true");
    this.barMark.className = "bar-mark";
    this.barMark.setAttribute("aria-hidden", "true");
    this.playedLayer.classList.add("played-layer");
    this.playedLayer.setAttribute("aria-hidden", "true");
  }

  show(exercise: Exercise, options: NotationOptions): void {
    clearTimeout(this.wrongFlashTimer);
    this.exercise = exercise;
    this.markedBar = null;
    this.columns.clear();
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

  /** Toggle note letters in the left and right margins of each staff. */
  setStaffLetters(on: boolean): void {
    if (on === this.staffLetters) return;
    this.staffLetters = on;
    this.draw();
  }

  /** Toggle showing played notes on the staff; it reserves room after the music, so it re-lays out. */
  setHighlightPlayed(on: boolean): void {
    if (on === this.highlightPlayed) return;
    this.highlightPlayed = on;
    this.draw();
  }

  /** Played notes only show in free play, never while an attempt is graded. */
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

  /** Washes the bar (from 1) a phrase went wrong in, until the next phrase is shown; null clears it. */
  markBar(bar: number | null): void {
    this.markedBar = bar;
    this.drawBarMark();
  }

  /** Where the drawn music starts, clef included, in CSS pixels from the top of the viewport. */
  inkTop(): number | null {
    let top = Infinity;
    for (const shape of this.root.querySelectorAll("svg path, svg rect, svg text")) {
      const box = shape.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) top = Math.min(top, box.top);
    }
    return Number.isFinite(top) ? top : null;
  }

  /** A clean phrase: the notes hop one after another, left to right. */
  celebrate(): void {
    this.graphicalNotes.forEach((note, i) => {
      // The SVG backend's notes have their own group; the type only knows the base class.
      const group = (note as GraphicalNote & { getSVGGElement?(): SVGGElement }).getSVGGElement?.();
      if (!group) return;
      group.classList.remove("note-wave");
      // Restart the animation on a group that ran it last time.
      void group.getBoundingClientRect();
      group.style.animationDelay = `${i * 60}ms`;
      group.classList.add("note-wave");
    });
  }

  /** Re-read the theme colors and redraw; staff lines and clefs only recolor on a reload. */
  refreshTheme(): void {
    const colors = readThemeColors();
    if (colors.pending === this.colors.pending && colors.correct === this.colors.correct) return;
    this.colors = colors;
    this.osmd.EngravingRules.applyDefaultColorMusic(colors.pending);
    void this.reload();
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
      this.drawStaffLetters();
      this.drawBarMark();
      this.drawPlayed();
      return;
    }

    // Short phrases fill the panel too aggressively; ease 1–3 bars down a bit.
    const bars = this.exercise?.bars.length ?? 4;
    const shortPhraseScale = bars <= 3 ? 0.8 : 1;
    // Letter margins scale with the music, so they widen the width being fitted.
    // The played-note column sits after the music, but the music stays centred, so reserve it both sides.
    const gutterW =
      (this.staffLetters ? LETTER_GUTTER_UNITS * 10 * 2 : 0) + (this.highlightPlayed ? GHOST_GUTTER_UNITS * 10 * 2 : 0);
    const zoom =
      Math.min(MAX_ZOOM, availW / (size.width + gutterW), availH / size.height) * shortPhraseScale;
    this.osmd.Zoom = Math.max(zoom, 0.5);
    this.root.style.width = `${Math.min(size.width * this.osmd.Zoom, availW)}px`;
    this.osmd.render();

    this.graphicalNotes = collectGraphicalNotes(this.osmd);
    this.applyColors();
    this.drawStaffLetters();
    this.drawBarMark();
    this.drawPlayed();
  }

  /** Places the bar wash over the marked bar's staff, a little above and below the lines. */
  private drawBarMark(): void {
    const measure = this.markedBar === null ? undefined : this.osmd.GraphicSheet?.MeasureList[this.markedBar - 1]?.[0];
    if (!measure) {
      this.barMark.remove();
      return;
    }
    const unit = 10 * this.osmd.Zoom;
    const box = measure.PositionAndShape;
    const { x, y } = box.AbsolutePosition;
    // A bar's box starts at its barline; the staff is four spaces tall from its top line.
    this.barMark.style.left = `${(x + box.BorderLeft) * unit}px`;
    this.barMark.style.width = `${(box.BorderRight - box.BorderLeft) * unit}px`;
    this.barMark.style.top = `${(y - 1.5) * unit}px`;
    this.barMark.style.height = `${7 * unit}px`;
    this.root.prepend(this.barMark);
  }

  /** Lay letters beside every staff line and space, outside the clef and final barline. */
  private drawStaffLetters(): void {
    this.lettersLayer.replaceChildren();
    if (!this.staffLetters || !this.exercise) {
      this.lettersLayer.remove();
      return;
    }
    const letters = STAFF_LETTERS[this.exercise.clef];
    const unit = 10 * this.osmd.Zoom;
    const column = LETTER_COLUMN_UNITS * unit;
    const gap = LETTER_GAP_UNITS * unit;
    const fontSize = `${0.9 * unit}px`;

    for (const page of this.osmd.GraphicSheet.MusicPages) {
      for (const system of page.MusicSystems) {
        for (const staffLine of system.StaffLines) {
          const measures = staffLine.Measures;
          if (!measures.length) continue;
          const first = measures[0].PositionAndShape;
          const last = measures[measures.length - 1].PositionAndShape;
          const left = staffLine.PositionAndShape.AbsolutePosition.x * unit;
          const right = (last.AbsolutePosition.x + last.BorderRight) * unit;
          // The right-hand letters go after the scratch bar, when there is one.
          const scratchRight = right + (this.highlightPlayed ? GHOST_GUTTER_UNITS * unit : 0);
          // StaffLine's y is its top line; lines are one staff space apart.
          const bottom = (first.AbsolutePosition.y + 4) * unit;

          letters.forEach((letter, step) => {
            const y = bottom - (step * unit) / 2;
            const isLine = step % 2 === 0;
            const inset = gap + (isLine ? 0 : column);
            for (const side of ["left", "right"] as const) {
              const label = document.createElement("span");
              label.className = "staff-letter";
              label.dataset.step = String(step);
              label.textContent = letter;
              label.style.top = `${y}px`;
              label.style.fontSize = fontSize;
              label.style.width = `${column}px`;
              label.style.textAlign = "center";
              label.style.left = `${side === "left" ? left - inset - column : scratchRight + inset}px`;
              this.lettersLayer.append(label);
            }
          });
        }
      }
    }
    this.root.append(this.lettersLayer);
  }

  /**
   * In free play, a short empty bar follows the music. Each played note thickens its staff
   * line or tints its space across the staff and that bar (ledger notes get faint ledger
   * lines out to them), lights its margin letter, and is written in the bar as the key
   * would spell it, accidental included. Drawn behind the music.
   */
  private drawPlayed(): void {
    const layer = this.playedLayer;
    layer.replaceChildren();
    for (const lit of this.root.querySelectorAll(".staff-letter.lit, .vf-keysignature .lit")) lit.classList.remove("lit");
    const exercise = this.exercise;
    if (!this.highlightPlayed || !this.freePlay || !this.ready || !exercise) {
      layer.remove();
      return;
    }
    const key = keyById(exercise.key);
    const bottomStep = BOTTOM_LINE_STEP[exercise.clef];
    const pitches = [...this.held, ...this.fading.keys()];
    for (const pitch of this.columns.keys()) if (!pitches.includes(pitch)) this.columns.delete(pitch);
    const notes = pitches.map((pitch) => {
      const { spelling, accidental } = spellInKey(pitch, key);
      return { pitch, spelling, position: staffStep(spelling) - bottomStep, accidental, fading: !this.held.has(pitch) };
    });
    // A newly pressed key takes the first column free of close neighbours: seconds sit side by
    // side, and accidentals close together step left, as engravers do.
    for (const note of notes) {
      if (this.columns.has(note.pitch)) continue;
      const placed = notes.filter((other) => this.columns.has(other.pitch));
      const free = (taken: number[]) => {
        let column = 0;
        while (taken.includes(column)) column++;
        return column;
      };
      const head = free(
        placed.filter((other) => Math.abs(other.position - note.position) <= 1).map((other) => this.columns.get(other.pitch)!.head),
      );
      const sign = note.accidental
        ? free(
            placed
              .filter((other) => other.accidental && Math.abs(other.position - note.position) < 6)
              .map((other) => this.columns.get(other.pitch)!.sign),
          )
        : 0;
      this.columns.set(note.pitch, { head, sign });
    }
    for (const label of this.lettersLayer.querySelectorAll<HTMLElement>(".staff-letter")) {
      if (notes.some((note) => String(note.position) === label.dataset.step)) label.classList.add("lit");
    }
    // A note the key signature sharpens or flattens lights that sign, in every key signature drawn.
    const signLetters = signatureLetters(key);
    for (const signature of this.root.querySelectorAll(".vf-keysignature")) {
      const signs = signature.querySelectorAll("path");
      for (const note of notes) {
        if (note.accidental || note.spelling.alter === 0) continue;
        signs[signLetters.indexOf(note.spelling.letter)]?.classList.add("lit");
      }
    }

    const unit = 10 * this.osmd.Zoom;
    const add = (parent: Element, tag: string, attrs: Record<string, string | number>, className: string) => {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
      node.setAttribute("class", className);
      parent.append(node);
      return node;
    };

    for (const page of this.osmd.GraphicSheet.MusicPages) {
      for (const system of page.MusicSystems) {
        for (const staffLine of system.StaffLines) {
          const measures = staffLine.Measures;
          if (!measures.length) continue;
          const first = measures[0].PositionAndShape;
          const last = measures[measures.length - 1].PositionAndShape;
          const left = staffLine.PositionAndShape.AbsolutePosition.x * unit;
          const right = (last.AbsolutePosition.x + last.BorderRight) * unit;
          // A hidden sheet lays out with no width; there's no staff to mark.
          if (right <= left) continue;
          const bottom = (first.AbsolutePosition.y + 4) * unit;
          const y = (position: number) => bottom - (position * unit) / 2;
          const scratchLeft = right + SCRATCH_GAP_UNITS * unit;
          const scratchRight = scratchLeft + SCRATCH_BAR_UNITS * unit;
          const ghostX = scratchLeft + GHOST_X_UNITS * unit;
          const lowest = -2 * MAX_LEDGERS;
          const highest = 8 + 2 * MAX_LEDGERS;
          // Across the music and across the scratch bar.
          const spans = [
            [left, right],
            [scratchLeft, scratchRight],
          ];

          for (let line = 0; line <= 8; line += 2) {
            add(layer, "line", { x1: scratchLeft, x2: scratchRight, y1: y(line), y2: y(line), "stroke-width": 0.1 * unit }, "scratch-line");
          }

          for (const note of notes) {
            const group = add(layer, "g", {}, note.fading ? "played-note fading" : "played-note");
            const { position } = note;
            if (position < lowest || position > highest) {
              const up = position > highest;
              const tip = y(up ? highest + 2 : lowest - 2);
              const base = tip + (up ? 1 : -1) * unit;
              add(group, "path", { d: `M${ghostX - 0.6 * unit} ${base} L${ghostX} ${tip} L${ghostX + 0.6 * unit} ${base} Z` }, "ghost-head");
              continue;
            }
            const { head, sign } = this.columns.get(note.pitch)!;
            const cx = ghostX + head * 1.2 * unit;
            const ledgers: number[] = [];
            for (let line = -2; line >= position; line -= 2) ledgers.push(line);
            for (let line = 10; line <= position; line += 2) ledgers.push(line);
            for (const line of ledgers) {
              if (line !== position) {
                for (const [x1, x2] of spans) add(group, "line", { x1, x2, y1: y(line), y2: y(line) }, "played-ledger");
              }
              add(group, "line", { x1: cx - 1.1 * unit, x2: cx + 1.1 * unit, y1: y(line), y2: y(line) }, "ghost-ledger");
            }
            for (const [x1, x2] of spans) {
              if (position % 2 === 0) {
                add(group, "line", { x1, x2, y1: y(position), y2: y(position) }, "played-line");
              } else {
                add(group, "rect", { x: x1, y: y(position) - unit / 2, width: x2 - x1, height: unit }, "played-space");
              }
            }

            add(
              group,
              "ellipse",
              { cx, cy: y(position), rx: 0.62 * unit, ry: 0.44 * unit, transform: `rotate(-20 ${cx} ${y(position)})` },
              "ghost-head",
            );
            if (note.accidental) {
              const x = ghostX - 1.5 * unit - sign * 1.1 * unit;
              const glyph = add(group, "g", { transform: `translate(${x} ${y(position)}) scale(${unit})` }, "ghost-accidental");
              const strokes = ACCIDENTAL_STROKES[note.accidental];
              add(glyph, "path", { d: strokes.thin, "stroke-width": 0.12 }, "");
              add(glyph, "path", { d: strokes.thick, "stroke-width": 0.28 }, "");
            }
          }
        }
      }
    }
    this.root.append(layer);
  }

  private applyColors(): void {
    const count = Math.min(this.states.length, this.graphicalNotes.length);
    for (let i = 0; i < count; i++) {
      this.graphicalNotes[i].setColor(this.colors[this.states[i]], COLOR_OPTS);
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
