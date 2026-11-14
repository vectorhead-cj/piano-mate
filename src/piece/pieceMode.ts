import { Metronome } from "../audio/metronome";
import { SoundQueue, type QueuedNote } from "../audio/soundQueue";
import type { Synth } from "../audio/synth";
import { KeyboardView, keyboardRangeFor } from "../render/keyboardView";
import type { KeyScaleHandlers } from "../render/keySpeaker";
import type { EventLog } from "../curriculum/eventLog";
import { newId, type PiecePass } from "../curriculum/events";
import type { NoteStream } from "../input/noteStream";
import { attachScreenInput } from "../input/screenInput";
import { midiNoteName } from "../music/pitch";
import { pieceWide, setPieceWide } from "../ui/pieceWidth";
import type { NoteEvent } from "../music/types";
import { pieceFeatures, type FeatureScore, type PieceFeature } from "./features";
import { applyPieceEvent, deviceState, openPieceLibrary, setDeviceState, type PieceChange, type PieceEvent, type PieceLibrary, type PieceRecord } from "./pieceLibrary";
import { parsePiece, PieceError, readScoreFile } from "./parseMusicXml";
import { playOrder, type HandChoice, type Piece } from "./piece";
import {
  FULL_STREAK,
  MISS_CHOICES,
  SLIP_CHOICES,
  nextPlace,
  phrasesOf,
  pieceDone,
  PLAN_LABELS,
  projectPieceProgress,
  stepKey,
  stepLabel,
  stepProgress,
  stepsFor,
  stepTempo,
  MIN_TEMPO,
  MAX_TEMPO,
  STREAK_CHOICES,
  streakMarks,
  type Phrase,
  type PiecePractice,
  type PieceSettings,
  type Place,
  type Plan,
  type StepProgress,
} from "./pieceProgress";
import { PieceScoreView, type MusicPoint, type NoteMark } from "./pieceScoreView";
import { PieceSession } from "./pieceSession";
import { scoreXml } from "./scoreXml";
import { soundsOf, type Sound } from "./sounding";
import { focusPlan, type FocusPlan } from "./focusLoop";
import { barRange, clipSpan, onsets, playSpan, type PlaySpan } from "./targets";
import type { ScoreSound } from "../ui/scoreSound";

/** Rest between one pass and the next one's count-in. */
const PASS_GAP_MS = 1500;
/** How often a pass checks the clock: missed notes, the cursor and its end. */
const TICK_MS = 25;
/** How long the last notes stay coloured before the pass's result. */
const PASS_TAIL_MS = 400;
/** Shortest a note sounds, however quick. */
const MIN_HOLD_SECONDS = 0.04;
/** Share of its length a detached note sounds, so repeated notes are heard as separate presses. */
const DETACHED = 0.9;
/** Taps further apart than this start a new tap-tempo count. */
const TAP_RESET_MS = 2500;
/** Size of the examples on the intro cards. */
const EXAMPLE_ZOOM = 0.7;
const ACCEPT = ".musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml";

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

function button(label: string, onClick: () => void, className = "btn-secondary", attrs: Record<string, string | boolean | undefined> = {}): HTMLButtonElement {
  const node = h("button", { class: className, type: "button", ...attrs }, label);
  node.addEventListener("click", onClick);
  return node;
}

function select<T extends string | number>(label: string, value: T, options: readonly { value: T; label: string }[], onChange: (value: T) => void): HTMLLabelElement {
  const input = h("select", { "aria-label": label });
  for (const option of options) {
    const node = h("option", { value: String(option.value) }, option.label);
    node.selected = option.value === value;
    input.append(node);
  }
  input.addEventListener("change", () => onChange(options[input.selectedIndex].value));
  return h("label", { class: "piece-field" }, h("span", { class: "field-caption" }, label), input);
}

function dots(marks: readonly ("pending" | "correct" | "wrong")[]): HTMLElement {
  const row = h("span", { class: "score-dots", role: "img", "aria-label": `${marks.filter((m) => m === "correct").length} of ${marks.length} clean` });
  for (const mark of marks) row.append(h("span", { class: "score-dot", "data-mark": mark }));
  return row;
}

type Screen =
  | { name: "library" }
  | { name: "piece" }
  | { name: "phrases" }
  | { name: "practice"; place: PracticePlace };

/** A phrase step, the full piece, or a card's intro drill. */
type PracticePlace = Place | { kind: "intro"; feature: string };

/** What a practice screen plays: its music, bars, hand and tempo, and how it's passed. */
interface Practice {
  piece: Piece;
  xml: string;
  /** The first drawn bar, as a measure index of `piece`. */
  firstMeasure: number;
  order: number[];
  hand: HandChoice;
  tempo: number;
  streak: number;
  misses: number;
  /** Wrong onsets a pass may have and still count. */
  slips: number;
  title: string;
  detail: string;
}

/** An open piece: its record, its score and what's read from it, and its practice so far. */
interface Open {
  record: PieceRecord;
  xml: string;
  piece: Piece;
  phrases: Phrase[];
  practice: PiecePractice;
}

export interface PieceModeDependencies {
  root: HTMLElement;
  stream: NoteStream;
  synth: Synth;
  /** MIDI keys sound through the synth (the display setting). */
  soundMidiKeys: () => boolean;
  /** Played keys light the staff in free play (the display setting). */
  highlightPlayed: () => boolean;
  /** Whether the score sounds the notes under the pointer on a tap/click or on hover. */
  scoreSound: () => ScoreSound;
  /** The MIDI key that starts and stops, as elsewhere in the app. */
  startKey: () => number;
  /** Where passes are recorded, with the rest of practice. */
  log: Promise<EventLog>;
  /** Told of each pass as it is recorded, for what is folded from the whole history (the activity chart). */
  onPass?: (pass: PiecePass) => void;
  /** This page load, as practice events record it. */
  session: string;
  /** The speaker button over a score's key signature. */
  keyScale: KeyScaleHandlers;
  /** Opens the sign-in dialog: pieces need an account. */
  signIn: () => void;
}

/** A pass under way: its grading, and what to undo when it stops. */
/** The focus loop running: its plan, the span it's cut from, and where it is. */
interface FocusRun {
  plan: FocusPlan;
  info: Practice;
  /** The phrase's span for the hand practised, cut down to the focus each time round. */
  full: PlaySpan;
  beatMs: number;
  /** performance.now() when the first time round starts, after any count-in bar. */
  loopStart: number;
  round: number;
  timer: number;
  clickTimers: number[];
}

interface Pass {
  session: PieceSession;
  /** Its bars, or the notes picked out in focus mode, timed from `origin` quarter beats into the place's span. */
  span: PlaySpan & { origin: number };
  /** The clock that closes missed notes and moves the cursor. */
  timer: number;
  /** The bar slot the cursor is in. */
  slot: number;
  /** When the last note was settled. */
  doneAt?: number;
  /** Epoch ms the count-in began. */
  startedAt: number;
}

/**
 * Pieces: imported MusicXML scores, split into phrases by the player and learned phrase by
 * phrase, each hand and then both, at a slow and a standard tempo, to a streak; then the
 * whole piece. Everything is graded in time, as rhythm mode is.
 */
export class PieceMode {
  private readonly root: HTMLElement;
  /** Null when signed out; undefined until opened. */
  private library: PieceLibrary | null | undefined = undefined;
  private log: EventLog | null = null;
  /** Every piece's passes, oldest first. */
  private passes: PiecePass[] = [];
  private screen: Screen = { name: "library" };
  private open: Open | null = null;
  private records: PieceRecord[] = [];
  private notice: { tone: "info" | "error"; text: string } | null = null;
  private visible = false;
  private view: PieceScoreView | null = null;
  private scroller: HTMLElement | null = null;
  /** The practice screen's on-screen keys: they follow MIDI, light under the mouse on the score, and play when clicked. */
  private keyboard: KeyboardView | null = null;
  private readonly metronome: Metronome;
  /** Practising: passes follow one another until stopped or the step is passed. */
  private looping = false;
  private pass: Pass | null = null;
  private nextPassTimer: number | undefined;
  private justPassed: PracticePlace | null = null;
  /** Mini scores of the intro cards, read once. */
  private readonly miniPieces = new Map<string, Piece>();
  /** The example scores on the piece page, kept so a resize redraws them. */
  private examples: PieceScoreView[] = [];
  /** Listening: the marks and cursor still to move with the music. */
  private soundTimers: number[] = [];
  /** The Listen playback is sounding; its button reads Stop. */
  private listening = false;
  /** Focus mode: drags on the score pick out notes, and practice repeats only those. */
  private focusMode = false;
  /** The notes picked out, first and last column, and the phrase they're in. */
  private focus: { phrase: number; from: MusicPoint; to: MusicPoint } | null = null;
  /** Clean times round the focus loop in a row, and the most so far; kept only while focusing. */
  private focusStreak = { current: 0, best: 0 };
  /** The focus loop while it runs. */
  private focusRun: FocusRun | null = null;
  /** The synth's notes still to sound: the other hand, or all of it when listening. */
  private readonly soundQueue: SoundQueue;

  constructor(private readonly deps: PieceModeDependencies) {
    this.root = deps.root;
    this.metronome = new Metronome({ click: (accent, bell) => deps.synth.click(accent, bell) });
    this.soundQueue = new SoundQueue(deps.synth);
    deps.stream.subscribe((event) => this.onNote(event));
    // Full width gives long scores more measures per line; it only differs from the menu's width on a wide window.
    const widthToggle = document.getElementById("piece-width");
    const showWidth = () => {
      const wide = pieceWide();
      widthToggle?.setAttribute("aria-pressed", String(wide));
      widthToggle?.setAttribute("aria-label", wide ? "Narrow" : "Widen");
    };
    showWidth();
    widthToggle?.addEventListener("click", () => {
      setPieceWide(!pieceWide());
      showWidth();
      if (this.screen.name === "practice") this.fitKeyboard(this.placeOf(this.screen.place).piece);
    });
    document.addEventListener("keydown", (event) => {
      if (this.visible && this.screen.name === "practice" && event.key === "Escape" && this.focus) {
        this.setFocus(null);
        return;
      }
      if (!this.visible || this.screen.name !== "practice" || event.code !== "Space" || event.repeat) return;
      if ((event.target as Element).closest("button, input, select, textarea, [contenteditable]")) return;
      event.preventDefault();
      // Listen is started and stopped by clicking; Space only drives practice.
      if (!this.listening) this.toggle();
    });
    new ResizeObserver(() => {
      this.view?.draw();
      for (const example of this.examples) example.draw();
    }).observe(this.root);
    this.root.addEventListener("dragover", (event) => {
      if (this.screen.name !== "library") return;
      event.preventDefault();
      this.root.dataset.drop = "";
    });
    this.root.addEventListener("dragleave", () => delete this.root.dataset.drop);
    this.root.addEventListener("drop", (event) => {
      delete this.root.dataset.drop;
      const file = event.dataTransfer?.files[0];
      if (this.screen.name !== "library" || !file) return;
      event.preventDefault();
      void this.importFile(file);
    });
  }

  /** Shows the library. */
  async show(): Promise<void> {
    this.visible = true;
    if (this.library === undefined) {
      try {
        const [library, log] = await Promise.all([openPieceLibrary(), this.deps.log]);
        this.library = library;
        this.log = log;
        this.passes = library ? await log.load({ types: ["piece-pass"] }) : [];
      } catch (error) {
        console.warn("Could not open the piece library", error);
        this.notice = { tone: "error", text: "Your pieces couldn't be loaded. Check the connection and reload the page." };
        this.library = null;
      }
    }
    await this.go({ name: "library" });
  }

  /** Leaving for another part of the app: stops any pass. */
  hide(): void {
    this.visible = false;
    this.stop();
  }

  /** The back button: up one screen; false at the library, where it leaves pieces. */
  back(): boolean {
    switch (this.screen.name) {
      case "library":
        return false;
      case "piece":
        void this.go({ name: "library" });
        return true;
      case "phrases":
      case "practice":
        void this.go({ name: "piece" });
        return true;
    }
  }

  private async go(screen: Screen): Promise<void> {
    this.stop();
    this.screen = screen;
    this.justPassed = null;
    if (screen.name === "library") {
      this.open = null;
      try {
        const records = (await this.library?.list()) ?? [];
        const seen = (r: PieceRecord) => Math.max(r.updatedAt, deviceState(r.id).openedAt ?? 0);
        this.records = records.sort((a, b) => seen(b) - seen(a));
      } catch (error) {
        console.warn("Could not list pieces", error);
        this.notice = { tone: "error", text: "Your pieces couldn't be loaded. Check the connection and try again." };
      }
    }
    this.render();
  }

  private render(): void {
    const scrolled = this.root.dataset.screen === this.screen.name ? this.root.scrollTop : 0;
    this.view = null;
    this.keyboard = null;
    this.deps.keyScale.useKeyboard?.(null);
    this.examples = [];
    this.scroller = null;
    this.root.dataset.screen = this.screen.name;
    switch (this.screen.name) {
      case "library":
        this.renderLibrary();
        break;
      case "piece":
        this.renderPiece();
        break;
      case "phrases":
        this.renderPhrases();
        break;
      case "practice":
        this.renderPractice(this.screen.place);
        break;
    }
    this.root.scrollTop = scrolled;
  }

  // ── Library ──────────────────────────────────────────────────────────────────────

  private renderLibrary(): void {
    const input = h("input", { type: "file", accept: ACCEPT, hidden: true });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void this.importFile(file);
      input.value = "";
    });
    if (!this.library) {
      this.renderSignedOut();
      return;
    }
    const importButton = button("Import MusicXML", () => input.click(), "btn-primary");
    const list = this.records.map((record) => {
      const done = pieceDone(this.practiceOf(record.id).progress, phrasesOf(record.phraseStarts, record.measureCount), record.settings.plan);
      const openButton = button("Open", () => void this.openPiece(record), "btn-primary");
      const remove = button("Remove", () => void this.removePiece(record), "btn-secondary piece-remove");
      return h(
        "article",
        { class: "menu-card piece-card" },
        h("h3", { class: "menu-card-title" }, record.title),
        record.composer && h("p", { class: "menu-muted" }, record.composer),
        h("p", { class: "menu-muted" }, `${done.passed} of ${done.total} steps passed`),
        h("div", { class: "menu-card-foot" }, remove, openButton),
      );
    });
    this.root.replaceChildren(
      h(
        "div",
        { class: "pieces-page" },
        h(
          "header",
          { class: "home-intro" },
          h("h1", { class: "home-title" }, "Pieces"),
          h(
            "p",
            { class: "home-lede" },
            "Bring your own score as MusicXML (.musicxml, .xml or .mxl). Split it into phrases, learn each hand apart and then together, slow and then up to tempo.",
          ),
        ),
        this.noticeElement(),
        h(
          "div",
          { class: "piece-import" },
          importButton,
          input,
          h("span", { class: "menu-muted" }, this.library.storage === "account" ? "Or drop a file here. Pieces are kept in your account." : "Or drop a file here. The dev server keeps pieces until the page closes."),
        ),
        list.length > 0 ? h("div", { class: "piece-list" }, ...list) : h("p", { class: "menu-muted piece-empty" }, "No pieces yet."),
      ),
    );
  }

  /** Pieces live in the account, so there's nothing to show without one. */
  private renderSignedOut(): void {
    this.root.replaceChildren(
      h(
        "div",
        { class: "pieces-page" },
        h(
          "header",
          { class: "home-intro" },
          h("h1", { class: "home-title" }, "Pieces"),
          h("p", { class: "home-lede" }, "Bring your own score as MusicXML, split it into phrases and learn it hand by hand. Pieces are kept in your account, so they follow you to any device."),
        ),
        this.noticeElement(),
        h("div", { class: "piece-import" }, button("Sign in", () => this.deps.signIn(), "btn-primary"), h("span", { class: "menu-muted" }, "Sign in to import and practise pieces.")),
      ),
    );
  }

  /** A piece's progress, folded from its passes. */
  private practiceOf(pieceId: string): PiecePractice {
    return projectPieceProgress(this.passes.filter((pass) => pass.pieceId === pieceId));
  }

  /**
   * Records a change to the open piece. It shows at once; the write follows in the background,
   * and if it fails the player is told on the next screen.
   */
  private commit(change: PieceChange): void {
    const open = this.open;
    if (!open || !this.library) return;
    const before = open.record;
    open.record = applyPieceEvent(before, { ...change, v: 1, id: "", at: Date.now(), pieceId: before.id } as PieceEvent);
    this.library.change(before, change).catch((error) => {
      console.warn("Could not save the piece", error);
      this.notice = { tone: "error", text: "A change to this piece couldn't be saved to your account." };
    });
  }

  /** Sounds the score notes the pointer picked out, together. */
  private playPitches(pitches: readonly number[]): void {
    this.deps.synth.unlock();
    for (const pitch of pitches) this.deps.synth.play(pitch);
  }

  private changeSettings(patch: Partial<PieceSettings>): void {
    const { settings } = this.open!.record;
    const next = { ...settings, ...patch };
    if ((Object.keys(patch) as (keyof PieceSettings)[]).every((key) => settings[key] === next[key])) return;
    this.commit({ type: "settings-changed", settings: next });
  }

  private noticeElement(): HTMLElement | null {
    if (!this.notice) return null;
    return h("p", { class: `piece-notice piece-notice-${this.notice.tone}`, role: "status" }, this.notice.text);
  }

  private async importFile(file: File): Promise<void> {
    try {
      const xml = await readScoreFile(file.name, await file.arrayBuffer());
      const piece = parsePiece(xml);
      const { record, existed } = await this.library!.import({
        xml,
        fileName: file.name,
        title: piece.title,
        composer: piece.composer,
        measureCount: piece.measures.length,
        tempo: piece.tempo,
      });
      if (existed) {
        this.notice = { tone: "info", text: `${record.title} is already here; opened it.` };
        await this.openPiece(record);
        return;
      }
      setDeviceState(record.id, { openedAt: Date.now(), introOpen: true });
      this.notice = piece.warnings.length > 0 ? { tone: "info", text: piece.warnings.join(" ") } : null;
      this.open = { record, xml, piece, phrases: phrasesOf([], piece.measures.length), practice: this.practiceOf(record.id) };
      // Splitting into phrases comes first; the piece page follows.
      await this.go({ name: "phrases" });
    } catch (error) {
      this.notice = {
        tone: "error",
        text: error instanceof PieceError ? error.message : `${file.name} couldn't be read as MusicXML, or couldn't be saved to your account.`,
      };
      if (!(error instanceof PieceError)) console.warn("Import failed", error);
      this.render();
    }
  }

  private async openPiece(record: PieceRecord): Promise<void> {
    let xml: string;
    try {
      xml = await this.library!.score(record);
    } catch (error) {
      console.warn("Could not load the score", error);
      this.notice = { tone: "error", text: `${record.title} couldn't be loaded. Check the connection and try again.` };
      this.render();
      return;
    }
    const piece = parsePiece(xml);
    setDeviceState(record.id, { openedAt: Date.now() });
    this.open = { record, xml, piece, phrases: phrasesOf(record.phraseStarts, piece.measures.length), practice: this.practiceOf(record.id) };
    await this.go({ name: "piece" });
  }

  private async removePiece(record: PieceRecord): Promise<void> {
    if (!confirm(`Remove ${record.title} from your pieces?`)) return;
    try {
      await this.library!.change(record, { type: "piece-archived" });
      this.notice = null;
    } catch (error) {
      console.warn("Could not remove the piece", error);
      this.notice = { tone: "error", text: `${record.title} couldn't be removed. Check the connection and try again.` };
    }
    await this.go({ name: "library" });
  }

  // ── Piece page ───────────────────────────────────────────────────────────────────

  private renderPiece(): void {
    const { record, piece, phrases, practice } = this.open!;
    const { settings } = record;
    const { progress } = practice;
    const steps = stepsFor(settings.plan);
    const next = nextPlace(progress, phrases, settings.plan);
    const done = pieceDone(progress, phrases, settings.plan);

    const introSection = this.introSection(record, piece, practice);

    const header = h("tr", {}, h("th", { scope: "col" }, "Phrase"), ...steps.map((step) => h("th", { scope: "col" }, stepLabel(step, settings.plan))));
    const rows = phrases.map((phrase, p) =>
      h(
        "tr",
        {},
        h("th", { scope: "row" }, `${p + 1} · ${this.barsText(phrase)}`),
        ...steps.map((step) => h("td", {}, this.stepChip({ kind: "phrase", phrase: p, step }, stepProgress(progress, phrase, step), settings.streak, next))),
      ),
    );
    const fullRow = h(
      "tr",
      { class: "piece-full-row" },
      h("th", { scope: "row" }, "Full piece"),
      h("td", { colspan: String(steps.length) }, this.stepChip({ kind: "full" }, progress.full, FULL_STREAK, next), h("span", { class: "menu-muted" }, ` both hands at ♩ = ${settings.tempo}, with repeats, once clean`)),
    );
    const continueButton = button(next.kind === "full" && progress.full?.passedAt ? "Play the full piece" : "Continue", () => void this.go({ name: "practice", place: next }), "btn-primary");

    this.root.replaceChildren(
      h(
        "div",
        { class: "pieces-page" },
        h(
          "header",
          { class: "piece-head" },
          h("div", {}, h("h1", { class: "home-title" }, record.title), record.composer && h("p", { class: "home-lede" }, record.composer)),
          h("div", { class: "piece-head-actions" }, h("span", { class: "menu-muted" }, `${done.passed} of ${done.total} steps`), continueButton),
        ),
        this.noticeElement(),
        introSection,
        h(
          "section",
          { class: "menu-card piece-section" },
          h(
            "div",
            { class: "piece-section-head" },
            h("h2", { class: "menu-card-title" }, "Phrases"),
            button("Edit phrases", () => void this.go({ name: "phrases" })),
          ),
          h("div", { class: "piece-table-wrap" }, h("table", { class: "piece-table" }, h("thead", {}, header), h("tbody", {}, ...rows, fullRow))),
        ),
        this.settingsSection(piece, settings),
      ),
    );
    this.notice = null;
  }

  /**
   * What the piece asks of the player, a card per thing: what it is, an example, and an
   * intro to play where one helps. Open on a new piece; it remembers being folded away.
   */
  private introSection(record: PieceRecord, piece: Piece, practice: PiecePractice): HTMLElement {
    const features = pieceFeatures(piece);
    const drills = features.filter((f) => f.drill);
    const played = drills.filter((f) => practice.intros[f.id]?.passedAt).length;
    const pending: { feature: PieceFeature; holder: HTMLElement }[] = [];
    const cards = features.map((feature) => {
      const holder = h("div", { class: "piece-feature-example" });
      if (feature.example) pending.push({ feature, holder });
      const passed = practice.intros[feature.id]?.passedAt !== undefined;
      const drill = feature.drill
        ? button(`${passed ? "✓ " : ""}${feature.drill.label}`, () => void this.go({ name: "practice", place: { kind: "intro", feature: feature.id } }), passed ? "btn-secondary piece-intro-play" : "btn-primary piece-intro-play")
        : null;
      return h(
        "li",
        { class: `piece-feature${feature.example ? " piece-feature-with-example" : ""}` },
        h("div", { class: "piece-feature-text" }, h("span", { class: "piece-feature-title" }, feature.title), h("span", { class: "menu-muted" }, feature.detail), drill),
        feature.example && holder,
      );
    });
    const details = h(
      "details",
      { class: "menu-card piece-section piece-intro" },
      h(
        "summary",
        {},
        h("h2", { class: "menu-card-title" }, "Before you start"),
        h("span", { class: "menu-muted" }, `What this piece asks of you${drills.length ? ` · ${played} of ${drills.length} intros played` : ""}`),
      ),
      h("ul", { class: "piece-features" }, ...cards),
    );
    details.open = deviceState(record.id).introOpen ?? true;
    let drawn = false;
    const drawExamples = () => {
      if (drawn || !details.open) return;
      drawn = true;
      for (const { feature, holder } of pending) this.drawExample(feature.example!, holder);
    };
    details.addEventListener("toggle", () => {
      setDeviceState(record.id, { introOpen: details.open });
      drawExamples();
    });
    // Drawn once the section is in the page and has a width.
    requestAnimationFrame(drawExamples);
    return details;
  }

  /** The music a card shows or drills: some of the piece's bars, or a mini score of its own. */
  private featureMusic(score: FeatureScore): { piece: Piece; xml: string; firstMeasure: number; order: number[] } {
    const { xml, piece } = this.open!;
    if (score.kind === "bars") {
      return { piece, xml: scoreXml(xml, score), firstMeasure: score.from, order: barRange(score.from, score.to) };
    }
    let mini = this.miniPieces.get(score.xml);
    if (!mini) {
      mini = parsePiece(score.xml);
      this.miniPieces.set(score.xml, mini);
    }
    return { piece: mini, xml: score.xml, firstMeasure: 0, order: barRange(0, mini.measures.length - 1) };
  }

  private drawExample(score: FeatureScore, holder: HTMLElement): void {
    const music = this.featureMusic(score);
    const view = new PieceScoreView(holder, EXAMPLE_ZOOM);
    this.examples.push(view);
    void view.show(music.xml, music.piece, music.firstMeasure).then(() => {
      if (score.kind === "bars") view.setMark(score.highlight, "current");
    });
  }

  private barsText(phrase: Phrase): string {
    const { measures } = this.open!.piece;
    const from = measures[phrase.from].label;
    const to = measures[phrase.to].label;
    return from === to ? `bar ${from}` : `bars ${from}–${to}`;
  }

  private stepChip(place: Place, progress: StepProgress | undefined, streak: number, next: Place): HTMLButtonElement {
    const hits = streakMarks(progress, streak).filter((m) => m === "correct").length;
    const passed = progress?.passedAt !== undefined;
    const isNext = samePlace(place, next);
    const chip = button(passed ? "✓" : progress ? `${hits}/${streak}` : "–", () => void this.go({ name: "practice", place }), "piece-chip", {
      "data-state": passed ? "passed" : isNext ? "next" : progress ? "started" : "open",
      "aria-label": `${place.kind === "full" ? "Full piece" : stepLabel(place.step, this.open!.record.settings.plan)}: ${passed ? "passed" : `${hits} of ${streak}`}`,
    });
    return chip;
  }

  private settingsSection(piece: Piece, settings: PieceSettings): HTMLElement {
    const update = (patch: Partial<PieceSettings>) => {
      this.changeSettings(patch);
      this.render();
    };
    const tempoField = (caption: string, key: "tempo" | "slowTempo", note: string) => {
      const input = h("input", { type: "number", min: String(MIN_TEMPO), max: String(MAX_TEMPO), step: "1", value: String(settings[key]), "aria-label": caption });
      input.addEventListener("change", () => {
        const value = Math.round(Number(input.value));
        if (value >= MIN_TEMPO && value <= MAX_TEMPO) update({ [key]: value });
      });
      const label = h("span", { class: "menu-muted" }, note);
      let taps: number[] = [];
      const tap = button("Tap", () => {
        const now = performance.now();
        if (taps.length > 0 && now - taps[taps.length - 1] > TAP_RESET_MS) taps = [];
        taps.push(now);
        if (taps.length < 3) {
          label.textContent = `Keep tapping the beat… (${taps.length})`;
          return;
        }
        const gaps = taps.slice(1).map((t, i) => t - taps[i]).sort((a, b) => a - b);
        const bpm = Math.round(60_000 / gaps[Math.floor(gaps.length / 2)]);
        if (bpm < MIN_TEMPO || bpm > MAX_TEMPO) return;
        input.value = String(bpm);
        this.changeSettings({ [key]: bpm });
        label.textContent = `♩ = ${bpm} from ${taps.length} taps`;
      }, "btn-secondary piece-tap");
      return { field: h("label", { class: "piece-field" }, h("span", { class: "field-caption" }, caption), h("span", { class: "piece-tempo" }, input, tap)), label };
    };
    const standard = tempoField("Standard tempo ♩", "tempo", piece.tempo ? `The score says ♩ = ${Math.round(piece.tempo)}.` : "The score gives no tempo: tap it in.");
    const slow = tempoField("Slow tempo ♩", "slowTempo", `Slow practice plays at ♩ = ${settings.slowTempo}, ${Math.round((settings.slowTempo / settings.tempo) * 100)}% of standard.`);

    const toggle = (label: string, checked: boolean, onChange: (on: boolean) => void) => {
      const box = h("input", { type: "checkbox" });
      box.checked = checked;
      box.addEventListener("change", () => onChange(box.checked));
      return h("label", { class: "toggle" }, box, h("span", {}, label));
    };

    return h(
      "section",
      { class: "menu-card piece-section" },
      h("h2", { class: "menu-card-title" }, "How to learn it"),
      h(
        "div",
        { class: "piece-settings" },
        select<Plan>("Plan", settings.plan, (Object.keys(PLAN_LABELS) as Plan[]).map((plan) => ({ value: plan, label: PLAN_LABELS[plan] })), (plan) => update({ plan })),
        select("Streak", settings.streak, STREAK_CHOICES.map((n) => ({ value: n, label: `${n} passes` })), (streak) => update({ streak, misses: Math.min(settings.misses, streak - 1) })),
        select(
          "Failed passes allowed",
          settings.misses,
          MISS_CHOICES.filter((n) => n < settings.streak).map((n) => ({ value: n, label: n === 0 ? "None" : `${n} per ${settings.streak}` })),
          (misses) => update({ misses }),
        ),
        select(
          "Wrong notes per pass",
          settings.slips,
          SLIP_CHOICES.map((n) => ({ value: n, label: n === 0 ? "None" : n === 1 ? "1 note or chord" : `${n} notes or chords` })),
          (slips) => update({ slips }),
        ),
        standard.field,
        settings.plan === "slow-first" && slow.field,
      ),
      standard.label,
      settings.plan === "slow-first" && slow.label,
      h(
        "div",
        { class: "piece-toggles" },
        toggle("Synth plays the other hand", settings.otherHand, (otherHand) => update({ otherHand })),
        toggle("Metronome through each pass", settings.metronome, (metronome) => update({ metronome })),
        toggle("Show fingering", settings.fingerings, (fingerings) => update({ fingerings })),
      ),
    );
  }

  // ── Phrase editor ────────────────────────────────────────────────────────────────

  private renderPhrases(): void {
    const open = this.open!;
    const { piece, record } = open;
    const starts = () => open.record.phraseStarts;
    const count = h("span", { class: "menu-muted" });
    const sheet = h("div", { class: "piece-score piece-score-edit" });
    const scroller = h("div", { class: "piece-scroll" }, sheet);
    const setStarts = (wanted: number[]) => {
      const phraseStarts = [...new Set(wanted.filter((s) => s > 0 && s < piece.measures.length))].sort((a, b) => a - b);
      if (phraseStarts.join() !== starts().join()) this.commit({ type: "phrases-changed", phraseStarts });
      open.phrases = phrasesOf(starts(), piece.measures.length);
      view.setBands(open.phrases);
      count.textContent = `${open.phrases.length} phrase${open.phrases.length === 1 ? "" : "s"}`;
    };
    const every = (bars: number) => setStarts(Array.from({ length: Math.ceil(piece.measures.length / bars) }, (_, i) => i * bars));
    const view = new PieceScoreView(sheet, undefined, true);
    view.setFingerings(record.settings.fingerings);
    view.setKeyScale(this.deps.keyScale);
    this.view = view;
    this.scroller = scroller;
    // Dragging across bars makes them one phrase; a tap on a bar starts a phrase there, or,
    // on a phrase's first bar, joins it to the one before.
    let drag: { anchor: number; at: number; pointer: number } | null = null;
    sheet.addEventListener("pointerdown", (event) => {
      const bar = view.barAt(event.clientX, event.clientY);
      if (bar === null || event.button > 0) return;
      drag = { anchor: bar, at: bar, pointer: event.pointerId };
      sheet.setPointerCapture(event.pointerId);
      view.setSelection({ from: bar, to: bar });
    });
    sheet.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      const bar = view.barAt(event.clientX, event.clientY);
      if (bar === null || bar === drag.at) return;
      drag.at = bar;
      view.setSelection({ from: drag.anchor, to: bar });
    });
    sheet.addEventListener("pointerup", (event) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      const { anchor, at } = drag;
      drag = null;
      view.setSelection(null);
      if (anchor !== at) {
        const from = Math.min(anchor, at);
        const to = Math.max(anchor, at);
        setStarts([...starts().filter((s) => s <= from || s > to), from, to + 1]);
      } else if (anchor > 0) {
        setStarts(starts().includes(anchor) ? starts().filter((s) => s !== anchor) : [...starts(), anchor]);
      }
    });
    sheet.addEventListener("pointercancel", () => {
      drag = null;
      view.setSelection(null);
    });
    this.root.replaceChildren(
      h(
        "div",
        { class: "pieces-page pieces-page-fill" },
        h(
          "header",
          { class: "piece-head" },
          h(
            "div",
            {},
            h("h1", { class: "menu-heading" }, `Phrases · ${record.title}`),
            h("p", { class: "menu-muted" }, "Drag across bars to make them one phrase. Tap a bar to start a phrase there; tap a phrase's first bar to join it to the one before."),
          ),
          h("div", { class: "piece-head-actions" }, count, button("Done", () => void this.go({ name: "piece" }), "btn-primary")),
        ),
        this.noticeElement(),
        h(
          "div",
          { class: "piece-quick" },
          button("Every 2 bars", () => every(2)),
          button("Every 4 bars", () => every(4)),
          button("Every 8 bars", () => every(8)),
          button("One phrase", () => setStarts([])),
        ),
        scroller,
      ),
    );
    void view.show(scoreXml(open.xml), piece).then(() => setStarts(starts()));
  }

  // ── Practice ─────────────────────────────────────────────────────────────────────

  private placeOf(place: PracticePlace): Practice {
    const { piece, record, xml, phrases } = this.open!;
    const { settings } = record;
    if (place.kind === "intro") {
      const feature = pieceFeatures(piece).find((f) => f.id === place.feature)!;
      const drill = feature.drill!;
      const tempo = stepTempo(settings, "slow");
      return {
        ...this.featureMusic(drill.score),
        hand: drill.hand,
        tempo,
        streak: 1,
        misses: 0,
        slips: 0,
        title: `Intro · ${feature.title}`,
        detail: `${drill.label} · ♩ = ${tempo}`,
      };
    }
    if (place.kind === "full") {
      return {
        piece,
        xml: scoreXml(xml),
        firstMeasure: 0,
        order: playOrder(piece.measures),
        hand: "both",
        tempo: settings.tempo,
        streak: FULL_STREAK,
        misses: 0,
        slips: 0,
        title: "Full piece",
        detail: `Both hands · ♩ = ${settings.tempo}`,
      };
    }
    const phrase = phrases[place.phrase];
    return {
      piece,
      xml: scoreXml(xml, phrase),
      firstMeasure: phrase.from,
      order: barRange(phrase.from, phrase.to),
      hand: place.step.hand,
      tempo: stepTempo(settings, place.step.speed),
      streak: settings.streak,
      misses: settings.misses,
      slips: settings.slips,
      title: `Phrase ${place.phrase + 1} of ${phrases.length} · ${this.barsText(phrase)}`,
      // The step is already shown by the selected chip above.
      detail: `♩ = ${stepTempo(settings, place.step.speed)}`,
    };
  }

  private progressAt(place: PracticePlace): StepProgress | undefined {
    const { practice, phrases } = this.open!;
    if (place.kind === "intro") return practice.intros[place.feature];
    return place.kind === "full" ? practice.progress.full : stepProgress(practice.progress, phrases[place.phrase], place.step);
  }

  private renderPractice(place: PracticePlace): void {
    const open = this.open!;
    const { record, phrases } = open;
    const pieceProgress = open.practice.progress;
    const info = this.placeOf(place);
    const progress = this.progressAt(place);
    // A focus belongs to its phrase: it stays across the phrase's steps, and goes with another.
    if (place.kind !== "phrase") this.focusMode = false;
    if (this.focus && (place.kind !== "phrase" || this.focus.phrase !== place.phrase)) this.focus = null;
    this.focusStreak = { current: 0, best: 0 };

    const chips =
      place.kind === "phrase"
        ? h(
            "div",
            { class: "piece-steps", role: "group", "aria-label": "Steps" },
            ...stepsFor(record.settings.plan).map((step) => {
              const sp = stepProgress(pieceProgress, phrases[place.phrase], step);
              const current = stepKey(step) === stepKey(place.step);
              return button(`${sp?.passedAt ? "✓ " : ""}${stepLabel(step, record.settings.plan)}`, () => void this.go({ name: "practice", place: { ...place, step } }), "piece-step", {
                "aria-pressed": String(current),
                "data-passed": sp?.passedAt ? "" : undefined,
              });
            }),
          )
        : null;

    const startButton = button(this.looping ? "Stop" : "Start", () => this.toggle(), "btn-secondary piece-start");
    const nextPhrase =
      place.kind === "phrase" && place.phrase < phrases.length - 1
        ? button("Next phrase", () => {
            const target = place.phrase + 1;
            const step = stepsFor(record.settings.plan).find((s) => !stepProgress(pieceProgress, phrases[target], s)?.passedAt) ?? place.step;
            void this.go({ name: "practice", place: { kind: "phrase", phrase: target, step } });
          })
        : null;
    const afterPass = this.justPassed && place.kind !== "intro" ? nextPlace(pieceProgress, phrases, record.settings.plan, place) : null;
    const nextStep =
      place.kind === "intro" && this.justPassed
        ? button("Back to the piece", () => void this.go({ name: "piece" }), "btn-primary")
        : afterPass && !samePlace(afterPass, place)
          ? button(`Next: ${this.placeName(afterPass)}`, () => void this.go({ name: "practice", place: afterPass }), "btn-primary")
          : null;
    const listen = button(this.listening ? "Stop" : "Listen", () => (this.listening ? this.stopListening() : this.listen()), "btn-secondary piece-listen");

    const otherHand = h("input", { type: "checkbox" });
    otherHand.checked = record.settings.otherHand;
    otherHand.disabled = info.hand === "both";
    otherHand.addEventListener("change", () => this.changeSettings({ otherHand: otherHand.checked }));

    const focusInput = h("input", { type: "checkbox" });
    focusInput.checked = this.focusMode;
    focusInput.addEventListener("change", () => {
      this.focusMode = focusInput.checked;
      sheet.classList.toggle("piece-score-focus", this.focusMode);
      if (!this.focusMode) this.setFocus(null);
      else this.refreshPractice();
    });
    const focusToggle = place.kind === "phrase" ? h("label", { class: "toggle piece-other" }, focusInput, h("span", {}, "Focus")) : null;

    const sheet = h("div", { class: `piece-score${this.focusMode ? " piece-score-focus" : ""}` });
    const scroller = h("div", { class: "piece-scroll piece-scroll-practice" }, sheet);
    const view = new PieceScoreView(sheet, undefined, true);
    view.setFingerings(record.settings.fingerings);
    view.setKeyScale(this.deps.keyScale);
    this.view = view;

    const fingerings = h("input", { type: "checkbox" });
    fingerings.checked = record.settings.fingerings;
    fingerings.addEventListener("change", () => {
      this.changeSettings({ fingerings: fingerings.checked });
      view.setFingerings(fingerings.checked);
    });
    view.setHighlightPlayed(this.deps.highlightPlayed());
    sheet.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;
      const { pitches, fresh } = view.hoverAt(event.clientX, event.clientY);
      if (!fresh) return;
      this.keyboard?.setHover(pitches);
      // With hover picked, reaching other notes plays them, as a click would; a pass being graded stays quiet.
      if (this.deps.scoreSound() === "hover" && pitches.length > 0 && !this.focusMode && !drag && !this.looping) this.playPitches(pitches);
    });
    sheet.addEventListener("pointerleave", () => {
      this.keyboard?.setHover([]);
      view.clearHover();
    });
    // In focus mode, dragging across the notes picks out the ones to repeat, a column at a time.
    let drag: { anchor: MusicPoint; pointer: number } | null = null;
    sheet.addEventListener("pointerdown", (event) => {
      if (!this.focusMode || place.kind !== "phrase" || (event.pointerType === "mouse" && event.button !== 0)) return;
      const point = view.columnAt(event.clientX, event.clientY);
      if (!point) return;
      event.stopImmediatePropagation();
      drag = { anchor: point, pointer: event.pointerId };
      sheet.setPointerCapture(event.pointerId);
      view.setFocus({ from: point, to: point });
    });
    sheet.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      const point = view.columnAt(event.clientX, event.clientY);
      if (point) view.setFocus({ from: drag.anchor, to: point });
    });
    const endDrag = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointer || place.kind !== "phrase") return;
      const point = view.columnAt(event.clientX, event.clientY);
      const anchor = drag.anchor;
      drag = null;
      const to = point ?? this.focus?.to ?? anchor;
      const [from, last] = beatsOf(info, anchor) <= beatsOf(info, to) ? [anchor, to] : [to, anchor];
      this.setFocus({ phrase: place.phrase, from, to: last });
    };
    sheet.addEventListener("pointerup", endDrag);
    sheet.addEventListener("pointercancel", endDrag);
    // Clicking the highlighted notes plays them together, unless hovering already does; touch has
    // no hover, so a tap always plays. A pass being graded stays quiet.
    sheet.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (this.focusMode) return;
      if (event.pointerType !== "touch" && this.deps.scoreSound() === "hover") return;
      const pitches = view.pitchesAt(event.clientX, event.clientY);
      if (!pitches || this.looping) return;
      this.playPitches(pitches);
      if (event.pointerType === "touch") {
        this.keyboard?.setHover(pitches);
        window.setTimeout(() => this.keyboard?.setHover([]), 400);
      }
    });
    const keys = h("div", { class: "keyboard" });
    keys.addEventListener("pointerdown", () => this.deps.synth.unlock(), { capture: true });
    attachScreenInput(keys, this.deps.stream);
    const keyArea = h("section", { class: "keyboard-area", "aria-label": "Keyboard" }, keys);
    this.keyboard = new KeyboardView(keys);
    this.deps.keyScale.useKeyboard?.(this.keyboard);
    this.scroller = scroller;

    const hotState = h("div", { class: "hot-state", "aria-live": "polite" }, this.hotText());
    this.root.replaceChildren(
      h(
        "div",
        { class: "stage piece-practice" },
        h(
          "div",
          { class: "practice-bar" },
          h("div", { class: "practice-bar-title" }, h("span", { class: "practice-bar-name" }, info.title), h("span", { class: "practice-bar-number" }, `${record.title} · ${info.detail}`)),
          chips,
        ),
        h(
          "div",
          { class: "status-row" },
          h("section", { class: "phrase-score", "aria-label": "Score", "data-focus": String(this.focused) }, this.streakStat(progress, info), this.focusStat()),
          h("section", { class: "transport", "aria-label": "Phrase controls" }, listen, nextPhrase, nextStep, startButton),
        ),
        h(
          "section",
          { class: "notation-panel", "data-hot": String(this.looping), "aria-label": "Notation" },
          hotState,
          h("div", { class: "notation-sheet" }, scroller),
          h("div", { class: "focus-strip", "aria-label": "Focus loop clicks" }),
          h(
            "div",
            { class: "piece-options" },
            h("label", { class: "toggle piece-other" }, otherHand, h("span", {}, info.hand === "both" ? "Both hands are yours" : `Synth plays the ${info.hand === "left" ? "right" : "left"} hand`)),
            h("label", { class: "toggle piece-other" }, fingerings, h("span", {}, "Fingering")),
            focusToggle,
          ),
        ),
      ),
    );
    this.root.querySelector(".piece-practice")!.append(keyArea);
    this.fitKeyboard(info.piece);
    void view.show(info.xml, info.piece, info.firstMeasure).then(() => {
      if (this.view === view && this.focus) view.setFocus(this.focus);
    });
    this.drawFocusStrip();
  }

  /** Picks out notes to repeat, or clears them; the next pass plays just those. */
  private setFocus(focus: { phrase: number; from: MusicPoint; to: MusicPoint } | null): void {
    this.focus = focus;
    this.view?.setFocus(focus);
    this.focusStreak = { current: 0, best: 0 };
    if (this.listening) this.stopListening();
    // The loop's shape changes with the notes: start again from a count-in.
    if (this.focusRun) this.stop();
    this.refreshPractice();
  }

  /** The focus loop for the notes picked out now; null without any. */
  private currentPlan(): { plan: FocusPlan; info: Practice } | null {
    if (!this.focused || this.screen.name !== "practice") return null;
    const info = this.placeOf(this.screen.place);
    const span = playSpan(info.piece, info.order, "both");
    const from = beatsOf(info, this.focus!.from);
    const last = beatsOf(info, this.focus!.to);
    const to = onsets(span).find((t) => t > last + 1e-9) ?? span.length;
    return { plan: focusPlan(info.piece, info.order, from, to), info };
  }

  /** The focus streak, apart from the step's: it's kept only while focusing and isn't saved. */
  private focusStat(): HTMLElement {
    const { current, best } = this.focusStreak;
    return h(
      "div",
      { class: "score-stat score-focus", hidden: !this.focused, title: "Clean times round the focus loop in a row. Practice only: it isn't saved and doesn't count to the step's streak." },
      h("span", { class: "score-label" }, "Focus"),
      h("span", { class: "score-count" }, String(current)),
      h("span", { class: "score-caption" }, `in a row${best > current ? ` · best ${best}` : ""} · not saved`),
    );
  }

  private refreshFocusStat(): void {
    const section = this.root.querySelector<HTMLElement>(".phrase-score");
    if (!section) return;
    section.dataset.focus = String(this.focused);
    section.querySelector(".score-focus")?.replaceWith(this.focusStat());
  }

  /**
   * The loop's clicks as a row of dots under the score: count-in clicks hollow and numbered,
   * beats with notes to play filled, those counting in the next repeat dashed.
   */
  private drawFocusStrip(): void {
    const strip = this.root.querySelector<HTMLElement>(".focus-strip");
    if (!strip) return;
    const current = this.currentPlan();
    strip.hidden = current === null;
    if (!current) return;
    const { plan } = current;
    const group = (label: string, clicks: FocusPlan["clicks"], className: string) => {
      const bars: HTMLElement[] = [];
      let number = 0;
      for (const click of clicks) {
        if (click.accent || bars.length === 0) bars.push(h("span", { class: "focus-bar" }));
        number = click.accent ? 1 : number + 1;
        bars[bars.length - 1].append(h("span", { class: `focus-click focus-click-${click.kind}`, "data-at": String(click.at) }, click.kind === "play" ? "" : String(number)));
      }
      return h("span", { class: `focus-group ${className}` }, h("span", { class: "focus-group-label" }, label), ...bars);
    };
    strip.replaceChildren(
      ...(plan.intro.length > 0 ? [group("First time", plan.intro, "focus-intro")] : []),
      group(plan.extra > 0 ? "Loop · a bar added to count in" : "Loop", plan.clicks, "focus-loop"),
      h("span", { class: "focus-repeat", "aria-hidden": "true" }, "↻"),
    );
  }

  /** Lights the click being heard on the strip. */
  private lightFocusClick(at: number | null): void {
    const strip = this.root.querySelector<HTMLElement>(".focus-strip");
    if (!strip) return;
    for (const node of strip.querySelectorAll<HTMLElement>(".focus-click")) {
      const now = at !== null && Number(node.dataset.at) === at && node.closest(at < 0 ? ".focus-intro" : ".focus-loop") !== null;
      node.toggleAttribute("data-now", now);
    }
  }

  /**
   * Focus practice: the picked-out notes round and round with the click going on throughout.
   * Each time round is graded on its own, marking the notes, and adds to the focus streak.
   */
  private startFocus(): void {
    const current = this.currentPlan();
    if (!current || !this.open || !this.view) return;
    const { plan, info } = current;
    const { record } = this.open;
    const beatMs = 60_000 / info.tempo;
    const begin = performance.now() + 150;
    const loopStart = begin + (plan.intro.length > 0 ? -plan.intro[0].at * beatMs : 0);
    const run: FocusRun = { plan, info, full: playSpan(info.piece, info.order, info.hand), beatMs, loopStart, round: -1, timer: 0, clickTimers: [] };
    this.focusRun = run;
    const click = (at: number, accent: boolean) =>
      run.clickTimers.push(window.setTimeout(() => this.deps.synth.click(accent, plan.beatsPerBar !== 4), Math.max(0, at - performance.now())));
    const scheduleRound = (round: number) => {
      const start = loopStart + round * plan.length * beatMs;
      for (const c of plan.clicks) click(start + c.at * beatMs, c.accent);
    };
    for (const c of plan.intro) click(loopStart + c.at * beatMs, c.accent);
    scheduleRound(0);
    this.view.clearMarks();
    const beginRound = (round: number) => {
      const time = performance.now();
      const before = this.pass;
      if (before) {
        for (const index of before.session.tick(time)) this.mark(index, "wrong");
        const clean = before.session.result().clean;
        const streak = clean ? this.focusStreak.current + 1 : 0;
        this.focusStreak = { current: streak, best: Math.max(this.focusStreak.best, streak) };
        this.refreshFocusStat();
        this.view?.clearMarks();
      }
      run.round = round;
      // The round after this one is clicked in now, so the click never waits on the timer.
      scheduleRound(round + 1);
      const start = loopStart + round * plan.length * beatMs;
      const span = { ...clipSpan(run.full, plan.from, plan.to, plan.origin), length: plan.length };
      const session = new PieceSession(span, info.tempo, 0);
      session.arm(start);
      if (record.settings.otherHand && info.hand !== "both") {
        this.soundQueue.play(queuedNotes(soundsOf(info.piece, span.others, info.tempo), start, beatMs, 0.55));
      }
      this.pass = { session, span, timer: 0, slot: -1, startedAt: Date.now() };
    };
    // A round starts half way through the clicks between the last note and the next first one,
    // so the one before has had its last notes' windows close and the next's haven't opened.
    const gap = plan.length - (plan.to - plan.origin) + (plan.from - plan.origin);
    // Measured from the next round's start: before it when its first note comes early in the bar.
    const handover = (plan.from - plan.origin - gap / 2) * beatMs;
    beginRound(0);
    run.timer = window.setInterval(() => {
      if (this.focusRun !== run) return;
      const time = performance.now();
      const pass = this.pass;
      if (pass) {
        for (const index of pass.session.tick(time)) this.mark(index, "wrong");
        this.follow(pass, time);
      }
      const beat = (time - loopStart) / beatMs;
      const into = beat < 0 ? beat : beat - Math.floor(beat / plan.length) * plan.length;
      const clicks = beat < 0 ? plan.intro : plan.clicks;
      const heard = [...clicks].reverse().find((c) => c.at <= into + 1e-6);
      this.lightFocusClick(heard ? heard.at : null);
      if (time >= loopStart + (run.round + 1) * plan.length * beatMs + handover) beginRound(run.round + 1);
    }, TICK_MS);
  }

  private stopFocus(): void {
    const run = this.focusRun;
    if (!run) return;
    clearInterval(run.timer);
    for (const timer of run.clickTimers) clearTimeout(timer);
    this.focusRun = null;
    this.lightFocusClick(null);
  }

  /**
   * The span a practice place plays for a hand: its bars, or, with notes picked out in focus
   * mode, from the first picked column up to the next note after the last.
   */
  private spanOf(info: Practice, hand: HandChoice): PlaySpan & { origin: number } {
    const span = playSpan(info.piece, info.order, hand);
    const focus = this.focusMode && this.screen.name === "practice" && this.screen.place.kind === "phrase" ? this.focus : null;
    if (!focus) return { ...span, origin: 0 };
    const from = beatsOf(info, focus.from);
    const last = beatsOf(info, focus.to);
    const to = onsets(span).find((t) => t > last + 1e-9) ?? span.length;
    return clipSpan(span, from, to);
  }

  /** Practising picked-out notes rather than the phrase: passes are drills and don't count to its streak. */
  private get focused(): boolean {
    return this.focusMode && this.focus !== null && this.screen.name === "practice" && this.screen.place.kind === "phrase";
  }

  /** Draws keys over the piece's whole range, at least as many octaves as fit the width. */
  private fitKeyboard(piece: Piece): void {
    const keyboard = this.keyboard;
    if (!keyboard) return;
    const pitches = piece.notes.filter((n) => !n.grace).map((n) => n.midi);
    if (pitches.length === 0) return;
    const { lowest, highest } = keyboardRangeFor(Math.min(...pitches), Math.max(...pitches), this.root.clientWidth);
    keyboard.setRange(lowest, highest);
  }

  /** Plays the music through with the cursor and notes following, both hands, at the step's tempo. */
  private listen(): void {
    if (this.screen.name !== "practice" || !this.view) return;
    this.stop();
    this.listening = true;
    this.refreshPractice();
    this.deps.synth.unlock();
    const info = this.placeOf(this.screen.place);
    const span = this.spanOf(info, "both");
    const beatMs = 60_000 / info.tempo;
    // Focused notes may start part way into a beat; they come in where they fall after it.
    const start = performance.now() + 300;
    const view = this.view;
    view.clearMarks();
    const at = (beat: number, run: () => void) =>
      this.soundTimers.push(window.setTimeout(run, Math.max(0, start + beat * beatMs - performance.now())));
    const targets = [...span.targets, ...span.ungraded];
    this.soundQueue.play(queuedNotes(soundsOf(info.piece, targets, info.tempo), start, beatMs, 0.6));
    for (const target of targets) {
      // A note's mark comes on with its grace notes.
      const from = target.due - (target.graces?.lead ?? 0);
      const notes = [...(target.graces?.notes ?? []), ...target.notes];
      at(from, () => view.setMark(notes, "current"));
      at(target.due + target.length, () => view.setMark(notes, "pending"));
    }
    span.order.forEach((measure, slot) =>
      at(span.slotStarts[slot], () => {
        view.setCursor(measure);
        if (this.scroller) view.scrollToBar(measure, this.scroller);
      }),
    );
    at(span.length, () => {
      view.setCursor(null);
      this.listening = false;
      this.refreshPractice();
    });
  }

  /** The Stop button: silences Listen and puts the score back as it was. */
  private stopListening(): void {
    this.stop();
    this.refreshPractice();
  }

  /** The notation panel's tag: live while passes run, otherwise how to start. */
  private hotText(): string {
    if (this.looping) return `● Live${this.focused ? " · Focus" : ""}`;
    const mode = !this.focusMode ? "Free play" : this.focus ? "Focus" : "Focus: drag across the notes to repeat";
    return `${mode} · ${midiNoteName(this.deps.startKey())} or Space to start`;
  }

  /** The streak as the curriculum draws it: clean passes out of what's needed, and what that takes. */
  private streakStat(progress: StepProgress | undefined, info: Practice): HTMLElement {
    const marks = streakMarks(progress, info.streak);
    const leeway = [info.misses > 0 && `${info.misses} may fail`, info.slips > 0 && `${info.slips} wrong note${info.slips > 1 ? "s" : ""} a pass`].filter(Boolean).join(" · ");
    const caption = progress?.passedAt !== undefined ? "Passed ✓" : leeway;
    return h(
      "div",
      { class: "score-stat score-streak" },
      h("span", { class: "score-label" }, "Streak"),
      dots(marks),
      h("span", { class: "score-count" }, h("span", {}, String(marks.filter((m) => m === "correct").length)), h("span", { class: "score-of" }, `/${info.streak}`)),
      h("span", { class: "score-caption", hidden: caption === "" }, caption),
    );
  }

  private placeName(place: Place | PracticePlace): string {
    if (place.kind === "intro") return "Intro";
    if (place.kind === "full") return "Full piece";
    const { record, phrases } = this.open!;
    const current = this.screen.name === "practice" && this.screen.place.kind === "phrase" ? this.screen.place.phrase : -1;
    const step = stepLabel(place.step, record.settings.plan);
    return place.phrase === current ? step : `Phrase ${place.phrase + 1}/${phrases.length}, ${step}`;
  }

  private toggle(): void {
    if (this.screen.name !== "practice") return;
    this.deps.synth.unlock();
    if (this.looping) {
      this.stop();
      } else {
      this.looping = true;
      this.justPassed = null;
      if (this.focused) this.startFocus();
      else this.startPass();
    }
    this.refreshPractice();
  }

  /** Redraws the practice screen's controls without reloading the score. */
  private refreshPractice(): void {
    if (this.screen.name !== "practice") return;
    const page = this.root.querySelector(".piece-practice");
    const start = page?.querySelector<HTMLButtonElement>(".piece-start");
    if (start) start.textContent = this.looping ? "Stop" : "Start";
    const listen = page?.querySelector<HTMLButtonElement>(".piece-listen");
    if (listen) listen.textContent = this.listening ? "Stop" : "Listen";
    const hot = page?.querySelector<HTMLElement>(".notation-panel");
    if (hot) hot.dataset.hot = String(this.looping);
    const state = page?.querySelector<HTMLElement>(".hot-state");
    if (state) state.textContent = this.hotText();
    this.view?.setFreePlay(!this.looping);
    this.drawFocusStrip();
    this.refreshFocusStat();
  }

  private startPass(): void {
    if (this.screen.name !== "practice" || !this.open || !this.view) return;
    const place = this.screen.place;
    const info = this.placeOf(place);
    const { record } = this.open;
    const { piece } = info;
    const span = { ...playSpan(piece, info.order, info.hand), origin: 0 };
    const beats = piece.measures[info.order[0]].beats;
    const countIn = beats;
    const session = new PieceSession(span, info.tempo, countIn);
    const now = performance.now();
    session.arm(now);
    const beatMs = 60_000 / info.tempo;
    this.metronome.start(info.tempo, record.settings.metronome ? countIn + Math.ceil(span.length) : countIn, now, beats);
    this.view.clearMarks();
    // The other hand of the pass before may still be sounding out; this one takes over.
    for (const timer of this.soundTimers) clearTimeout(timer);
    this.soundTimers = [];
    if (record.settings.otherHand && info.hand !== "both") {
      this.soundQueue.play(queuedNotes(soundsOf(piece, span.others, info.tempo), session.start!, beatMs, 0.55));
    } else this.soundQueue.stop();
    const pass: Pass = { session, span, timer: 0, slot: -1, startedAt: Date.now() };
    this.pass = pass;
    this.refreshPractice();
    const step = () => {
      if (this.pass !== pass) return;
      const time = performance.now();
      for (const index of session.tick(time)) this.mark(index, "wrong");
      this.follow(pass, time);
      // Every note played or gone: a moment to see the last ones coloured, then the result.
      pass.doneAt ??= session.done ? time : undefined;
      if (pass.doneAt !== undefined && time >= pass.doneAt + PASS_TAIL_MS) this.finishPass(pass);
    };
    // A timer rather than animation frames, which stop while the page is hidden.
    pass.timer = window.setInterval(step, TICK_MS);
  }

  /** Keeps the bar being played in view and washed, and clears a repeated bar's marks from its last time through. */
  private follow(pass: Pass, time: number): void {
    const beat = pass.session.beatAt(time);
    let slot = 0;
    while (slot < pass.span.slotStarts.length - 1 && pass.span.slotStarts[slot + 1] <= beat) slot++;
    if (beat < 0 || slot === pass.slot) return;
    pass.slot = slot;
    const measure = pass.span.order[slot];
    // A bar played again after a repeat starts clean; its marks from the first time go.
    if (pass.span.order.indexOf(measure) < slot) {
      for (const target of pass.session.targets) if (target.slot === slot) this.view?.setMark(target.notes, "pending");
    }
    this.view?.setCursor(measure);
    if (this.scroller) this.view?.scrollToBar(measure, this.scroller);
  }

  private mark(index: number, mark: NoteMark): void {
    const target = this.pass?.session.targets[index];
    if (target) this.view?.setMark(target.notes, mark);
  }

  private onNote(event: NoteEvent): void {
    if (!this.visible) return;
    this.keyboard?.setPressed(event.pitch, event.kind === "on");
    if (event.source === "screen") {
      // Clicked keys sound and light the staff, but only a real keyboard is graded.
      this.view?.setHighlightPlayed(this.deps.highlightPlayed());
      this.view?.setPlayed(event.pitch, event.kind === "on");
      if (event.kind === "on") this.deps.synth.play(event.pitch, event.velocity);
      return;
    }
    if (event.source !== "midi") return;
    if (event.pitch === this.deps.startKey()) {
      if (event.kind === "on" && !this.listening) this.toggle();
      return;
    }
    this.view?.setHighlightPlayed(this.deps.highlightPlayed());
    this.view?.setPlayed(event.pitch, event.kind === "on");
    if (event.kind !== "on") return;
    if (this.deps.soundMidiKeys()) this.deps.synth.play(event.pitch, event.velocity);
    const pass = this.pass;
    if (!pass) return;
    const played = pass.session.play(event.pitch, event.time);
    switch (played.kind) {
      case "hit":
        this.mark(played.index, pass.session.stateOf(played.index));
        break;
      case "wrong":
      case "early":
        this.mark(played.index, "wrong");
        break;
    }
  }

  private finishPass(pass: Pass): void {
    if (this.pass !== pass || this.screen.name !== "practice" || !this.open) return;
    this.clearPass();
    this.metronome.stop();
    const place = this.screen.place;
    const info = this.placeOf(place);
    const result = pass.session.result(info.slips);
    const open = this.open;
    const before = this.progressAt(place);
    const phrase = place.kind === "phrase" ? open.phrases[place.phrase] : undefined;
    const event: PiecePass = {
      type: "piece-pass",
      v: 1,
      id: newId(),
      at: Date.now(),
      startedAt: pass.startedAt,
      session: this.deps.session,
      pieceId: open.record.id,
      scoreHash: open.record.scoreHash,
      place: place.kind === "phrase" ? { kind: "phrase", from: phrase!.from, to: phrase!.to, hand: place.step.hand, speed: place.step.speed } : place,
      tempo: info.tempo,
      streak: info.streak,
      misses: info.misses,
      slips: info.slips,
      clean: result.clean,
      notes: pass.session.targets.map((_, i) => pass.session.stateOf(i)),
    };
    this.passes.push(event);
    this.deps.onPass?.(event);
    this.log?.append(event).catch((error) => {
      console.warn("Could not save the pass", error);
      this.notice = { tone: "error", text: "Practice on this piece couldn't be saved to your account." };
    });
    open.practice = this.practiceOf(open.record.id);
    const after = this.progressAt(place)!;
    const newlyPassed = before?.passedAt === undefined && after.passedAt !== undefined;
    if (newlyPassed) {
      this.looping = false;
      this.justPassed = place;
      this.metronome.stop();
      // Redraw for the next-step button; the passed pass's colours go with it.
      this.renderPractice(place);
      return;
    }
    this.refreshStreak(after, info);
    this.refreshPractice();
    if (this.looping) this.nextPassTimer = window.setTimeout(() => this.looping && this.startPass(), PASS_GAP_MS);
  }

  private refreshStreak(progress: StepProgress, info: Practice): void {
    this.root.querySelector(".phrase-score .score-stat")?.replaceWith(this.streakStat(progress, info));
  }

  private clearPass(): void {
    const pass = this.pass;
    if (!pass) return;
    clearInterval(pass.timer);
    this.pass = null;
  }

  private stop(): void {
    if (this.listening || this.focusRun) this.view?.clearMarks();
    this.stopFocus();
    this.listening = false;
    this.looping = false;
    clearTimeout(this.nextPassTimer);
    this.clearPass();
    for (const timer of this.soundTimers) clearTimeout(timer);
    this.soundTimers = [];
    this.soundQueue.stop();
    this.metronome.stop();
    this.view?.setCursor(null);
  }
}

/** Sounds for the synth, `start` being when the span's first beat falls (a performance.now() time). */
function queuedNotes(sounds: readonly Sound[], start: number, beatMs: number, velocity: number): QueuedNote[] {
  return sounds.map((sound) => ({
    pitch: sound.pitch,
    velocity: velocity * sound.velocity,
    holdSeconds: Math.max(MIN_HOLD_SECONDS, (sound.length * beatMs * (sound.legato ? 1 : DETACHED)) / 1000),
    at: start + sound.at * beatMs,
  }));
}

function samePlace(a: PracticePlace, b: PracticePlace): boolean {
  if (a.kind === "intro" || b.kind === "intro") return a.kind === "intro" && b.kind === "intro" && a.feature === b.feature;
  if (a.kind === "full" || b.kind === "full") return a.kind === b.kind;
  return a.phrase === b.phrase && stepKey(a.step) === stepKey(b.step);
}

/** Quarter beats from the start of a practice place's span to a place in its music. */
function beatsOf(info: Practice, point: MusicPoint): number {
  const slot = info.order.indexOf(point.measure);
  let at = 0;
  for (let i = 0; i < slot; i++) at += info.piece.measures[info.order[i]].length;
  return at + point.offset;
}
