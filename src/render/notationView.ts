import { OpenSheetMusicDisplay, type GraphicalNote } from "opensheetmusicdisplay";
import { spellInKey } from "../music/accidentals";
import { inScale, keyById, signatureLetters } from "../music/keys";
import { KeySpeaker, type KeyScaleHandlers } from "./keySpeaker";
import { exerciseToMusicXml } from "../music/musicXml";
import { staffStep } from "../music/pitch";
import { BEATS } from "../music/rhythms";
import { pressedIndices } from "../music/ties";
import type { Clef, Exercise } from "../music/types";

export type NoteState = "pending" | "current" | "correct" | "late" | "wrong";

/**
 * How long a pressed note was held, in quarter beats from the first note's onset: the key
 * went down at `from` and up (or is still down) at `to`; its written length ends at `until`.
 * Live while it's held; short or long once it's let go too soon or held too long.
 */
export interface HoldMark {
  from: number;
  to: number;
  until: number;
  state: "live" | "short" | "long";
}

/** Which signatures changed from the phrase before, to be circled. */
export interface SignatureChange {
  key: boolean;
  time: boolean;
}

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
/** Flashcards show one bar, so it can be drawn larger. */
const NUMBERED_MAX_ZOOM = 6;
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
/** Played notes further out than this many ledger lines aren't marked. */
const MAX_LEDGERS = 4;
const RELEASE_FADE_MS = 150;
/** The hold lane sits this far below the staff's bottom line, or its lowest note, in staff spaces. */
const HOLD_LANE_UNITS = 2;
const HOLD_LANE_NOTE_GAP_UNITS = 1.4;
const HOLD_BAR_UNITS = 0.45;
/** Pressed notes take turns between two lanes this far apart, so a hold into the next note stays apart from it. */
const HOLD_LANE_STEP_UNITS = 0.7;
/** The pencil loop round a new key signature: drawn, held, then faded into the count-in. */
const KEY_CIRCLE_DRAW_MS = 1500;
const KEY_CIRCLE_MS = 3500;
/** How far the loop clears the signature sideways, and its half-height, in staff spaces. */
const KEY_CIRCLE_PAD_UNITS = 1.1;
const KEY_CIRCLE_RY_UNITS = 3.5;
/** An empty C major slot gets a smaller loop, to sit in the narrow gap: its padding and half-height. */
const EMPTY_KEY_CIRCLE_PAD_UNITS = 0.7;
const EMPTY_KEY_CIRCLE_RY_UNITS = 2.8;
const SVG_NS = "http://www.w3.org/2000/svg";
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
  private keySpeaker: KeySpeaker | null = null;
  private colors = readThemeColors();
  private staffLetters = false;
  private readonly lettersLayer = document.createElement("div");
  /** Flashcards: each note's place in the bar written above it. */
  private numbers = false;
  private readonly numbersLayer = document.createElement("div");
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
  private readonly playedLayer = document.createElementNS(SVG_NS, "svg");
  private readonly holds = new Map<number, HoldMark>();
  /** Signatures to circle once the phrase being loaded is drawn. */
  private circlePending: SignatureChange | null = null;
  /** The loop being drawn, kept so a re-render (which clears the container) can put it back. */
  private keyCircle: SVGSVGElement | null = null;
  private readonly holdLayer = document.createElementNS(SVG_NS, "svg");

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
    this.numbersLayer.className = "note-numbers";
    this.numbersLayer.setAttribute("aria-hidden", "true");
    this.lettersLayer.className = "staff-letters";
    this.lettersLayer.setAttribute("aria-hidden", "true");
    this.barMark.className = "bar-mark";
    this.barMark.setAttribute("aria-hidden", "true");
    this.playedLayer.classList.add("played-layer");
    this.playedLayer.setAttribute("aria-hidden", "true");
    this.holdLayer.classList.add("hold-layer");
    this.holdLayer.setAttribute("aria-hidden", "true");
  }

  /** Adds a speaker button over the key signature that plays the phrase's key. */
  setKeyScale(handlers: KeyScaleHandlers): void {
    this.keySpeaker = new KeySpeaker(this.root, handlers);
    this.placeKeySpeaker();
  }

  private placeKeySpeaker(): void {
    if (this.exercise) this.keySpeaker?.place(keyById(this.exercise.key));
  }

  show(exercise: Exercise, options: NotationOptions): void {
    clearTimeout(this.wrongFlashTimer);
    this.exercise = exercise;
    this.markedBar = null;
    this.holds.clear();
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

  /** Number the notes 1, 2, 3… above the staff, the order an answer is entered in. */
  setNumbers(on: boolean): void {
    if (on === this.numbers) return;
    this.numbers = on;
    this.drawNumbers();
  }

  /** Toggle showing played notes on the staff. */
  setHighlightPlayed(on: boolean): void {
    if (on === this.highlightPlayed) return;
    this.highlightPlayed = on;
    this.drawPlayed();
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

  setHold(index: number, hold: HoldMark | null): void {
    if (hold) this.holds.set(index, hold);
    else if (!this.holds.delete(index)) return;
    this.drawHolds();
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
    if (this.circlePending) this.circleSignatures(this.circlePending);
  }

  /**
   * Circles each changed signature with a pencil loop, as soon as the phrase being shown is
   * drawn. C major has no key signature, so its empty place before the time signature is circled.
   */
  circleSignatures(changed: SignatureChange): void {
    this.circlePending = this.ready ? null : changed;
    if (this.circlePending) return;
    const origin = this.root.getBoundingClientRect();
    const unit = 10 * this.osmd.Zoom;
    const span = (selector: string) =>
      [...this.root.querySelectorAll(selector)].map((shape) => {
        const box = shape.getBoundingClientRect();
        return { left: box.left - origin.left, right: box.right - origin.left, middle: (box.top + box.bottom) / 2 - origin.top };
      });
    const areas: { left: number; right: number; middle: number; empty?: true }[] = [];
    if (changed.key) {
      const signatures = span(".vf-keysignature");
      const clef = span(".vf-clef")[0];
      const time = span(".vf-timesignature")[0];
      if (signatures.length > 0) areas.push(...signatures);
      else if (clef && time) areas.push({ left: clef.right, right: time.left, middle: clef.middle, empty: true });
    }
    if (changed.time) areas.push(...span(".vf-timesignature"));
    if (areas.length === 0) return;
    // Centred on the staff the signature sits on, not on the signs, which sit high or low.
    const staffMiddles = [...this.root.querySelectorAll(".staffline")].map((staff) => {
      // Halfway between its top and bottom lines (the flat paths); the group's own box reaches further.
      const ys = [...staff.querySelectorAll("path")]
        .map((line) => line.getBoundingClientRect())
        .filter((box) => box.height < 2)
        .map((box) => (box.top + box.bottom) / 2 - origin.top);
      return (Math.min(...ys) + Math.max(...ys)) / 2;
    });
    const layer = document.createElementNS(SVG_NS, "svg");
    layer.classList.add("key-circle-layer");
    layer.setAttribute("aria-hidden", "true");
    for (const area of areas) {
      const cy = staffMiddles.reduce(
        (best, y) => (Math.abs(y - area.middle) < Math.abs(best - area.middle) ? y : best),
        staffMiddles[0] ?? area.middle,
      );
      const pad = area.empty ? EMPTY_KEY_CIRCLE_PAD_UNITS : KEY_CIRCLE_PAD_UNITS;
      const ry = area.empty ? EMPTY_KEY_CIRCLE_RY_UNITS : KEY_CIRCLE_RY_UNITS;
      const d = pencilLoop((area.left + area.right) / 2, cy, (area.right - area.left) / 2 + pad * unit, ry * unit);
      const group = document.createElementNS(SVG_NS, "g");
      // A firm line, and a fainter one just off it, for the grain of a pencil.
      for (const [stroke, shift, className] of [[0.45, 0, "key-circle"], [0.18, 0.11, "key-circle grain"]] as const) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        path.setAttribute("class", className);
        path.setAttribute("stroke-width", String(stroke * unit));
        path.setAttribute("transform", `translate(${shift * unit} ${-shift * unit})`);
        group.append(path);
      }
      layer.append(group);
    }
    this.keyCircle?.remove();
    this.keyCircle = layer;
    this.root.append(layer);
    for (const path of layer.querySelectorAll("path")) {
      const length = path.getTotalLength();
      path.style.strokeDasharray = String(length);
      path.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], {
        duration: KEY_CIRCLE_DRAW_MS,
        easing: "cubic-bezier(.45,.05,.35,1)",
        fill: "forwards",
      });
    }
    const done = () => {
      layer.remove();
      if (this.keyCircle === layer) this.keyCircle = null;
    };
    layer.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: KEY_CIRCLE_MS }).finished.then(done, done);
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
      this.drawHolds();
      this.drawNumbers();
      this.placeKeySpeaker();
      if (this.keyCircle) this.root.append(this.keyCircle);
      return;
    }

    // Short phrases fill the panel too aggressively; ease 1–3 bars down a bit.
    const bars = this.exercise?.bars.length ?? 4;
    const shortPhraseScale = bars <= 3 && !this.numbers ? 0.8 : 1;
    // Letter margins scale with the music, so they widen the width being fitted.
    const gutterW = this.staffLetters ? LETTER_GUTTER_UNITS * 10 * 2 : 0;
    const zoom =
      Math.min(this.numbers ? NUMBERED_MAX_ZOOM : MAX_ZOOM, availW / (size.width + gutterW), availH / size.height) * shortPhraseScale;
    this.osmd.Zoom = Math.max(zoom, 0.5);
    this.root.style.width = `${Math.min(size.width * this.osmd.Zoom, availW)}px`;
    this.osmd.render();

    this.graphicalNotes = collectGraphicalNotes(this.osmd);
    this.applyColors();
    this.drawStaffLetters();
    this.drawBarMark();
    this.drawPlayed();
    this.drawHolds();
    this.drawNumbers();
    this.placeKeySpeaker();
    if (this.keyCircle) this.root.append(this.keyCircle);
  }

  /** Writes each note's number just above it, centred on its notehead. */
  private drawNumbers(): void {
    const layer = this.numbersLayer;
    layer.replaceChildren();
    if (!this.numbers) {
      layer.remove();
      return;
    }
    const origin = this.root.getBoundingClientRect();
    const unit = 10 * this.osmd.Zoom;
    this.graphicalNotes.forEach((note, i) => {
      // The SVG backend's notes have their own group; the type only knows the base class.
      const group = (note as GraphicalNote & { getSVGGElement?(): SVGGElement }).getSVGGElement?.();
      if (!group) return;
      const head = group.querySelector(".vf-notehead")?.getBoundingClientRect() ?? group.getBoundingClientRect();
      const top = Math.min(head.top, group.getBoundingClientRect().top);
      const label = document.createElement("span");
      label.className = "note-number";
      label.textContent = String(i + 1);
      label.style.left = `${head.left + head.width / 2 - origin.left}px`;
      label.style.top = `${top - origin.top - 0.4 * unit}px`;
      label.style.fontSize = `${1.15 * unit}px`;
      layer.append(label);
    });
    this.root.append(layer);
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
              label.style.left = `${side === "left" ? left - inset - column : right + inset}px`;
              this.lettersLayer.append(label);
            }
          });
        }
      }
    }
    this.root.append(this.lettersLayer);
  }

  /**
   * In free play, each played note thickens its staff line or tints its space across the
   * staff (ledger notes get faint ledger lines out to them), and lights its margin letter.
   * Yellow for a note in the key's scale, red for one outside it. Drawn behind the music.
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
    const notes = pitches.map((pitch) => {
      const { spelling, accidental } = spellInKey(pitch, key);
      return { pitch, spelling, position: staffStep(spelling) - bottomStep, accidental, fading: !this.held.has(pitch), inScale: inScale(pitch, key) };
    });
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
          const lowest = -2 * MAX_LEDGERS;
          const highest = 8 + 2 * MAX_LEDGERS;

          for (const note of notes) {
            const { position } = note;
            if (position < lowest || position > highest) continue;
            const tone = `${note.fading ? "played-note fading" : "played-note"}${note.inScale ? "" : " off-scale"}`;
            const group = add(layer, "g", {}, tone);
            for (let line = -2; line > position; line -= 2) add(group, "line", { x1: left, x2: right, y1: y(line), y2: y(line) }, "played-ledger");
            for (let line = 10; line < position; line += 2) add(group, "line", { x1: left, x2: right, y1: y(line), y2: y(line) }, "played-ledger");
            if (position % 2 === 0) {
              add(group, "line", { x1: left, x2: right, y1: y(position), y2: y(position) }, "played-line");
            } else {
              add(group, "rect", { x: left, y: y(position) - unit / 2, width: right - left, height: unit }, "played-space");
            }
          }
        }
      }
    }
    this.root.append(layer);
  }

  /**
   * Each held note gets a bar in a lane under its staff, laid out in time like the notes
   * above it: its written length as a faint track, and the time the key was down filled in.
   */
  private drawHolds(): void {
    const layer = this.holdLayer;
    layer.replaceChildren();
    const exercise = this.exercise;
    if (this.holds.size === 0 || !this.ready || !exercise) {
      layer.remove();
      return;
    }
    const unit = 10 * this.osmd.Zoom;
    const notes = exercise.bars.flat();
    const onsets: number[] = [];
    notes.reduce((beat, note) => (onsets.push(beat), beat + BEATS[note.duration]), 0);
    const phraseBeats = notes.reduce((sum, note) => sum + BEATS[note.duration], 0);
    const heads = this.graphicalNotes.map((note) => {
      const { x, y } = note.PositionAndShape.AbsolutePosition;
      const measure = note.parentVoiceEntry.parentStaffEntry.parentMeasure;
      const box = measure.PositionAndShape;
      return {
        x: x * unit,
        y: y * unit,
        staffTop: box.AbsolutePosition.y * unit,
        barEnd: (box.AbsolutePosition.x + box.BorderRight) * unit,
      };
    });
    if (heads.length < notes.length) return;
    // Beat → x along the music: each note's span runs to the next note, or to its barline
    // when the next note starts a new line. Past the end, it carries on at the last span's pace.
    const xAt = (beat: number, line: number): number => {
      let k = 0;
      while (k < notes.length - 1 && onsets[k + 1] <= beat) k++;
      const next = heads[k + 1];
      const end = next && next.staffTop === heads[k].staffTop ? next.x : heads[k].barEnd;
      const endBeat = onsets[k + 1] ?? phraseBeats;
      const x = heads[k].x + ((beat - onsets[k]) / (endBeat - onsets[k])) * (end - heads[k].x);
      // A bar that runs onto the next line stops at its own line's end.
      return heads[k].staffTop === line ? x : heads.filter((h) => h.staffTop === line).reduce((m, h) => Math.max(m, h.barEnd), 0);
    };
    const lanes = new Map<number, number>();
    for (const head of heads) {
      const lowest = Math.max(lanes.get(head.staffTop) ?? head.staffTop + HOLD_LANE_UNITS * unit + 4 * unit, head.y + HOLD_LANE_NOTE_GAP_UNITS * unit);
      lanes.set(head.staffTop, lowest);
    }
    const add = (tag: string, attrs: Record<string, string | number>, className: string) => {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
      node.setAttribute("class", className);
      layer.append(node);
    };
    const height = HOLD_BAR_UNITS * unit;
    const pressed = pressedIndices(notes);
    // Faults on top, so a note held into the next shows over that note's live trail.
    const ordered = [...this.holds].sort(([, a], [, b]) => Number(a.state !== "live") - Number(b.state !== "live"));
    for (const [index, hold] of ordered) {
      const head = heads[index];
      if (!head) continue;
      const y = lanes.get(head.staffTop)! - height / 2 + (pressed.indexOf(index) % 2) * HOLD_LANE_STEP_UNITS * unit;
      const start = xAt(onsets[index], head.staffTop);
      const target = xAt(hold.until, head.staffTop);
      add("rect", { x: start, y, width: Math.max(0, target - start), height, rx: height / 2 }, "hold-track");
      const from = Math.max(start, xAt(hold.from, head.staffTop));
      const to = xAt(hold.to, head.staffTop);
      if (to > from) add("rect", { x: from, y, width: to - from, height, rx: height / 2 }, `hold-bar ${hold.state}`);
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

/**
 * A hand-drawn loop round (cx, cy): a wobbly ellipse that goes round a little more than
 * once, drifting as it goes, so its ends overlap like a quick pencil circle. Each is different.
 */
function pencilLoop(cx: number, cy: number, rx: number, ry: number): string {
  const steps = 90;
  const turns = 1.18;
  const phase = Math.random() * 2 * Math.PI;
  const start = -2.4 + Math.random() * 0.5;
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = start + t * turns * 2 * Math.PI;
    const wobble = 1 + 0.06 * Math.sin(angle * 2 + phase) + 0.04 * Math.sin(angle * 3.3 + phase * 1.7);
    points.push([
      cx + Math.cos(angle) * rx * wobble * (1 + 0.1 * t) + (t - 0.5) * 0.04 * rx,
      cy + Math.sin(angle) * ry * wobble * (1 + 0.05 * t) - t * 0.08 * ry,
    ]);
  }
  const at = ([x, y]: [number, number]) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  let d = `M${at(points[0])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    d += ` Q${at([x, y])} ${at([(x + nx) / 2, (y + ny) / 2])}`;
  }
  return d;
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
