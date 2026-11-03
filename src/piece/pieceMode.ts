import { Metronome } from "../audio/metronome";
import type { Synth } from "../audio/synth";
import type { NoteStream } from "../input/noteStream";
import { midiNoteName } from "../music/pitch";
import type { NoteEvent } from "../music/types";
import { pieceFeatures } from "./features";
import { openPieceLibrary, pieceId, type PieceLibrary, type PieceRecord } from "./pieceLibrary";
import { parsePiece, PieceError, readScoreFile } from "./parseMusicXml";
import { playOrder, type Piece } from "./piece";
import {
  defaultSettings,
  FULL_STREAK,
  MISS_CHOICES,
  nextPlace,
  phrasesOf,
  pieceDone,
  PLAN_LABELS,
  recordPass,
  stepKey,
  stepLabel,
  stepProgress,
  stepsFor,
  stepTempo,
  STREAK_CHOICES,
  streakMarks,
  withStep,
  type Phrase,
  type PieceSettings,
  type Place,
  type Plan,
  type StepProgress,
} from "./pieceProgress";
import { PieceScoreView, type NoteMark } from "./pieceScoreView";
import { PieceSession, type FaultKind, type PassResult } from "./pieceSession";
import { scoreXml } from "./scoreXml";
import { barRange, playSpan, type PlaySpan } from "./targets";

/** Rest between one pass and the next one's count-in. */
const PASS_GAP_MS = 1500;
/** How long the last notes stay coloured before the pass's result. */
const PASS_TAIL_MS = 400;
/** Taps further apart than this start a new tap-tempo count. */
const TAP_RESET_MS = 2500;
const SLOW_SHARES = [0.4, 0.5, 0.6, 0.7, 0.8] as const;
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

const FAULT_TEXT: Record<FaultKind, string> = { wrong: "Wrong note", early: "Too early", missed: "Missed a note" };
const FAULT_EMOJI: Record<FaultKind, string> = { wrong: "❌", early: "⏩", missed: "🙈" };

type Screen =
  | { name: "library" }
  | { name: "piece" }
  | { name: "phrases" }
  | { name: "practice"; place: Place };

/** An open piece: its record and what's read from its file. */
interface Open {
  record: PieceRecord;
  piece: Piece;
  phrases: Phrase[];
}

export interface PieceModeDependencies {
  root: HTMLElement;
  stream: NoteStream;
  synth: Synth;
  /** MIDI keys sound through the synth (the display setting). */
  soundMidiKeys: () => boolean;
  /** The MIDI key that starts and stops, as elsewhere in the app. */
  startKey: () => number;
}

/** A pass under way: its grading, and what to undo when it stops. */
interface Pass {
  session: PieceSession;
  span: PlaySpan;
  frame: number;
  /** The bar slot the cursor is in. */
  slot: number;
  /** When the last note was settled. */
  doneAt?: number;
}

/**
 * Pieces: imported MusicXML scores, split into phrases by the player and learned phrase by
 * phrase, each hand and then both, at a slow and a standard tempo, to a streak; then the
 * whole piece. Everything is graded in time, as rhythm mode is.
 */
export class PieceMode {
  private readonly root: HTMLElement;
  private library: PieceLibrary | null = null;
  private persistent = true;
  private screen: Screen = { name: "library" };
  private open: Open | null = null;
  private records: PieceRecord[] = [];
  private notice: { tone: "info" | "error"; text: string } | null = null;
  private visible = false;
  private view: PieceScoreView | null = null;
  private scroller: HTMLElement | null = null;
  private readonly metronome: Metronome;
  /** Practising: passes follow one another until stopped or the step is passed. */
  private looping = false;
  private pass: Pass | null = null;
  private nextPassTimer: number | undefined;
  private result: { text: string; tone: "perfect" | "fault" | "info" } | null = null;
  private justPassed: Place | null = null;
  private taps: number[] = [];
  /** The synth's notes for the other hand, still to sound. */
  private soundTimers: number[] = [];

  constructor(private readonly deps: PieceModeDependencies) {
    this.root = deps.root;
    this.metronome = new Metronome({ click: (accent) => deps.synth.click(accent) });
    deps.stream.subscribe((event) => this.onNote(event));
    document.addEventListener("keydown", (event) => {
      if (!this.visible || this.screen.name !== "practice" || event.code !== "Space" || event.repeat) return;
      if ((event.target as Element).closest("button, input, select, textarea, [contenteditable]")) return;
      event.preventDefault();
      this.toggle();
    });
    new ResizeObserver(() => this.view?.draw()).observe(this.root);
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
    if (!this.library) {
      const opened = await openPieceLibrary();
      this.library = opened.library;
      this.persistent = opened.persistent;
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
    this.result = null;
    this.justPassed = null;
    if (screen.name === "library") {
      this.open = null;
      this.records = (await this.library?.list()) ?? [];
    }
    this.render();
  }

  private render(): void {
    const scrolled = this.root.dataset.screen === this.screen.name ? this.root.scrollTop : 0;
    this.view = null;
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
    const importButton = button("Import MusicXML", () => input.click(), "btn-primary");
    const list = this.records.map((record) => {
      const done = pieceDone(record.progress, phrasesOf(record.phraseStarts, record.measureCount), record.settings.plan);
      const openButton = button("Open", () => void this.openPiece(record.id), "btn-primary");
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
          h("span", { class: "menu-muted" }, this.persistent ? "Or drop a file here. Pieces are kept in this browser." : "Pieces can't be kept in this browser; they last until the page closes."),
        ),
        list.length > 0 ? h("div", { class: "piece-list" }, ...list) : h("p", { class: "menu-muted piece-empty" }, "No pieces yet."),
      ),
    );
  }

  private noticeElement(): HTMLElement | null {
    if (!this.notice) return null;
    return h("p", { class: `piece-notice piece-notice-${this.notice.tone}`, role: "status" }, this.notice.text);
  }

  private async importFile(file: File): Promise<void> {
    try {
      const xml = await readScoreFile(file.name, await file.arrayBuffer());
      const piece = parsePiece(xml);
      const id = await pieceId(xml);
      const existing = await this.library!.get(id);
      if (existing) {
        this.notice = { tone: "info", text: `${existing.title} is already here; opened it.` };
        await this.openPiece(id);
        return;
      }
      const now = Date.now();
      const record: PieceRecord = {
        id,
        title: piece.title,
        composer: piece.composer,
        fileName: file.name,
        xml,
        measureCount: piece.measures.length,
        addedAt: now,
        openedAt: now,
        phraseStarts: [],
        settings: defaultSettings(piece.tempo),
        progress: { phrases: {} },
        introDone: false,
      };
      await this.library!.put(record);
      this.notice = piece.warnings.length > 0 ? { tone: "info", text: piece.warnings.join(" ") } : null;
      this.open = { record, piece, phrases: phrasesOf([], piece.measures.length) };
      // Splitting into phrases comes first; the piece page follows.
      await this.go({ name: "phrases" });
    } catch (error) {
      this.notice = {
        tone: "error",
        text: error instanceof PieceError ? error.message : `${file.name} couldn't be read as MusicXML.`,
      };
      if (!(error instanceof PieceError)) console.warn("Import failed", error);
      this.render();
    }
  }

  private async openPiece(id: string): Promise<void> {
    const record = await this.library!.get(id);
    if (!record) return;
    const piece = parsePiece(record.xml);
    record.openedAt = Date.now();
    await this.library!.put(record);
    this.open = { record, piece, phrases: phrasesOf(record.phraseStarts, piece.measures.length) };
    await this.go({ name: "piece" });
  }

  private async removePiece(record: PieceRecord): Promise<void> {
    if (!confirm(`Remove ${record.title} and its progress from this browser?`)) return;
    await this.library!.remove(record.id);
    this.notice = null;
    await this.go({ name: "library" });
  }

  private save(): void {
    if (!this.open) return;
    const record = this.open.record;
    void this.library!.put(record).catch((error) => console.warn("Could not save the piece", error));
  }

  // ── Piece page ───────────────────────────────────────────────────────────────────

  private renderPiece(): void {
    const { record, piece, phrases } = this.open!;
    const { settings } = record;
    const steps = stepsFor(settings.plan);
    const next = nextPlace(record.progress, phrases, settings.plan);
    const done = pieceDone(record.progress, phrases, settings.plan);

    const intro = pieceFeatures(piece).map((feature) =>
      h("li", { class: "piece-feature" }, h("span", { class: "piece-feature-title" }, feature.title), h("span", { class: "menu-muted" }, feature.detail)),
    );
    const introSection = record.introDone
      ? h("details", { class: "menu-card piece-section" }, h("summary", { class: "menu-card-title" }, "Notation in this piece"), h("ul", { class: "piece-features" }, ...intro))
      : h(
          "section",
          { class: "menu-card piece-section piece-intro" },
          h("h2", { class: "menu-card-title" }, "Before you start"),
          h("p", { class: "menu-muted" }, "What this piece asks of you. Read it through, or skip it."),
          h("ul", { class: "piece-features" }, ...intro),
          h(
            "div",
            { class: "menu-card-foot menu-card-foot-end" },
            button("Skip", () => this.finishIntro()),
            button("Got it", () => this.finishIntro(), "btn-primary"),
          ),
        );

    const header = h("tr", {}, h("th", { scope: "col" }, "Phrase"), ...steps.map((step) => h("th", { scope: "col" }, stepLabel(step, settings.plan))));
    const rows = phrases.map((phrase, p) =>
      h(
        "tr",
        {},
        h("th", { scope: "row" }, `${p + 1} · ${this.barsText(phrase)}`),
        ...steps.map((step) => h("td", {}, this.stepChip({ kind: "phrase", phrase: p, step }, stepProgress(record.progress, phrase, step), settings.streak, next))),
      ),
    );
    const fullRow = h(
      "tr",
      { class: "piece-full-row" },
      h("th", { scope: "row" }, "Full piece"),
      h("td", { colspan: String(steps.length) }, this.stepChip({ kind: "full" }, record.progress.full, FULL_STREAK, next), h("span", { class: "menu-muted" }, ` both hands at ♩ = ${settings.tempo}, with repeats, once clean`)),
    );
    const continueButton = button(next.kind === "full" && record.progress.full?.passedAt ? "Play the full piece" : "Continue", () => void this.go({ name: "practice", place: next }), "btn-primary");

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

  private finishIntro(): void {
    this.open!.record.introDone = true;
    this.save();
    this.render();
  }

  private barsText(phrase: Phrase): string {
    const { measures } = this.open!.piece;
    const from = measures[phrase.from].label;
    const to = measures[phrase.to].label;
    return from === to ? `bar ${from}` : `bars ${from}–${to}`;
  }

  private stepChip(place: Place, progress: StepProgress | undefined, streak: number, next: Place): HTMLButtonElement {
    const passed = progress?.passedAt !== undefined;
    const hits = streakMarks(progress, streak).filter((m) => m === "correct").length;
    const isNext = samePlace(place, next);
    const chip = button(passed ? "✓" : progress ? `${hits}/${streak}` : "–", () => void this.go({ name: "practice", place }), "piece-chip", {
      "data-state": passed ? "passed" : isNext ? "next" : progress ? "started" : "open",
      "aria-label": `${place.kind === "full" ? "Full piece" : stepLabel(place.step, this.open!.record.settings.plan)}: ${passed ? "passed" : `${hits} of ${streak}`}`,
    });
    return chip;
  }

  private settingsSection(piece: Piece, settings: PieceSettings): HTMLElement {
    const update = (patch: Partial<PieceSettings>) => {
      Object.assign(this.open!.record.settings, patch);
      this.save();
      this.render();
    };
    const tempoInput = h("input", { type: "number", min: "20", max: "240", step: "1", value: String(settings.tempo), "aria-label": "Standard tempo" });
    tempoInput.addEventListener("change", () => {
      const value = Math.round(Number(tempoInput.value));
      if (value >= 20 && value <= 240) update({ tempo: value });
    });
    const tapLabel = h("span", { class: "menu-muted" }, piece.tempo ? `The score says ♩ = ${Math.round(piece.tempo)}.` : "The score gives no tempo: tap it in.");
    const tap = button("Tap", () => {
      const now = performance.now();
      if (this.taps.length > 0 && now - this.taps[this.taps.length - 1] > TAP_RESET_MS) this.taps = [];
      this.taps.push(now);
      if (this.taps.length < 3) {
        tapLabel.textContent = `Keep tapping the beat… (${this.taps.length})`;
        return;
      }
      const gaps = this.taps.slice(1).map((t, i) => t - this.taps[i]).sort((a, b) => a - b);
      const bpm = Math.round(60_000 / gaps[Math.floor(gaps.length / 2)]);
      if (bpm < 20 || bpm > 240) return;
      tempoInput.value = String(bpm);
      this.open!.record.settings.tempo = bpm;
      this.save();
      tapLabel.textContent = `♩ = ${bpm} from ${this.taps.length} taps`;
    }, "btn-secondary piece-tap");

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
          "Misses allowed",
          settings.misses,
          MISS_CHOICES.filter((n) => n < settings.streak).map((n) => ({ value: n, label: n === 0 ? "None" : `${n} per ${settings.streak}` })),
          (misses) => update({ misses }),
        ),
        h("label", { class: "piece-field" }, h("span", { class: "field-caption" }, "Standard tempo ♩"), h("span", { class: "piece-tempo" }, tempoInput, tap)),
        settings.plan === "slow-first" &&
          select("Slow tempo", settings.slowShare, SLOW_SHARES.map((share) => ({ value: share, label: `${Math.round(share * 100)}% · ♩ = ${stepTempo({ ...settings, slowShare: share }, "slow")}` })), (slowShare) =>
            update({ slowShare }),
          ),
      ),
      tapLabel,
      h(
        "div",
        { class: "piece-toggles" },
        toggle("Synth plays the other hand", settings.otherHand, (otherHand) => update({ otherHand })),
        toggle("Metronome through each pass", settings.metronome, (metronome) => update({ metronome })),
      ),
    );
  }

  // ── Phrase editor ────────────────────────────────────────────────────────────────

  private renderPhrases(): void {
    const open = this.open!;
    const { piece, record } = open;
    const count = h("span", { class: "menu-muted" });
    const sheet = h("div", { class: "piece-score piece-score-edit" });
    const scroller = h("div", { class: "piece-scroll" }, sheet);
    const setStarts = (starts: number[]) => {
      record.phraseStarts = [...new Set(starts.filter((s) => s > 0 && s < piece.measures.length))].sort((a, b) => a - b);
      open.phrases = phrasesOf(record.phraseStarts, piece.measures.length);
      this.save();
      view.markPhrases([0, ...record.phraseStarts]);
      count.textContent = `${open.phrases.length} phrase${open.phrases.length === 1 ? "" : "s"}`;
    };
    const every = (bars: number) => setStarts(Array.from({ length: Math.ceil(piece.measures.length / bars) }, (_, i) => i * bars));
    const view = new PieceScoreView(sheet);
    this.view = view;
    this.scroller = scroller;
    sheet.addEventListener("click", (event) => {
      const bar = view.barAt(event.clientX, event.clientY);
      if (bar === null || bar === 0) return;
      const starts = record.phraseStarts.includes(bar) ? record.phraseStarts.filter((s) => s !== bar) : [...record.phraseStarts, bar];
      setStarts(starts);
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
            h("p", { class: "menu-muted" }, "Tap a bar to start a new phrase there; tap it again to join it to the phrase before."),
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
    void view.show(scoreXml(record.xml), piece).then(() => setStarts(record.phraseStarts));
  }

  // ── Practice ─────────────────────────────────────────────────────────────────────

  private placeOf(place: Place): { order: number[]; hand: "left" | "right" | "both"; tempo: number; streak: number; misses: number; title: string; detail: string; xmlBars?: Phrase } {
    const { piece, record, phrases } = this.open!;
    const { settings } = record;
    if (place.kind === "full") {
      return {
        order: playOrder(piece.measures),
        hand: "both",
        tempo: settings.tempo,
        streak: FULL_STREAK,
        misses: 0,
        title: "Full piece",
        detail: `Both hands · ♩ = ${settings.tempo}`,
      };
    }
    const phrase = phrases[place.phrase];
    return {
      order: barRange(phrase.from, phrase.to),
      hand: place.step.hand,
      tempo: stepTempo(settings, place.step.speed),
      streak: settings.streak,
      misses: settings.misses,
      title: `Phrase ${place.phrase + 1} of ${phrases.length} · ${this.barsText(phrase)}`,
      detail: `${stepLabel(place.step, settings.plan)} · ♩ = ${stepTempo(settings, place.step.speed)}`,
      xmlBars: phrase,
    };
  }

  private progressAt(place: Place): StepProgress | undefined {
    const { record, phrases } = this.open!;
    return place.kind === "full" ? record.progress.full : stepProgress(record.progress, phrases[place.phrase], place.step);
  }

  private renderPractice(place: Place): void {
    const open = this.open!;
    const { piece, record, phrases } = open;
    const info = this.placeOf(place);
    const progress = this.progressAt(place);
    const passed = progress?.passedAt !== undefined;

    const chips =
      place.kind === "phrase"
        ? h(
            "div",
            { class: "piece-steps", role: "group", "aria-label": "Steps" },
            ...stepsFor(record.settings.plan).map((step) => {
              const sp = stepProgress(record.progress, phrases[place.phrase], step);
              const current = stepKey(step) === stepKey(place.step);
              return button(`${sp?.passedAt ? "✓ " : ""}${stepLabel(step, record.settings.plan)}`, () => void this.go({ name: "practice", place: { ...place, step } }), "piece-step", {
                "aria-pressed": String(current),
                "data-passed": sp?.passedAt ? "" : undefined,
              });
            }),
          )
        : null;

    const startButton = button(this.looping ? "Stop" : "Start", () => this.toggle(), "btn-primary piece-start");
    const nextPhrase =
      place.kind === "phrase" && place.phrase < phrases.length - 1
        ? button("Next phrase", () => {
            const target = place.phrase + 1;
            const step = stepsFor(record.settings.plan).find((s) => !stepProgress(record.progress, phrases[target], s)?.passedAt) ?? place.step;
            void this.go({ name: "practice", place: { kind: "phrase", phrase: target, step } });
          })
        : null;
    const afterPass = this.justPassed ? nextPlace(record.progress, phrases, record.settings.plan, place) : null;
    const nextStep = afterPass && !samePlace(afterPass, place) ? button(`Next: ${this.placeName(afterPass)}`, () => void this.go({ name: "practice", place: afterPass }), "btn-primary") : null;

    const otherHand = h("input", { type: "checkbox" });
    otherHand.checked = record.settings.otherHand;
    otherHand.disabled = info.hand === "both";
    otherHand.addEventListener("change", () => {
      record.settings.otherHand = otherHand.checked;
      this.save();
    });

    const sheet = h("div", { class: "piece-score" });
    const scroller = h("div", { class: "piece-scroll piece-scroll-practice" }, sheet);
    const view = new PieceScoreView(sheet);
    this.view = view;
    this.scroller = scroller;

    this.root.replaceChildren(
      h(
        "div",
        { class: "pieces-page pieces-page-fill piece-practice" },
        h(
          "header",
          { class: "piece-head" },
          h("div", {}, h("h1", { class: "menu-heading" }, info.title), h("p", { class: "menu-muted" }, `${record.title} · ${info.detail}`)),
          h("div", { class: "piece-head-actions" }, nextPhrase, nextStep, startButton),
        ),
        chips,
        h(
          "div",
          { class: "piece-status" },
          h("span", { class: "score-label" }, "Streak"),
          dots(streakMarks(progress, info.streak)),
          h(
            "span",
            { class: "menu-muted" },
            passed
              ? "Passed ✓"
              : info.misses > 0
                ? `${info.streak} passes, ${info.misses} may go wrong`
                : `${info.streak} clean pass${info.streak === 1 ? "" : "es"}`,
          ),
          h("span", { class: "piece-status-gap" }),
          h("label", { class: "toggle piece-other" }, otherHand, h("span", {}, info.hand === "both" ? "Both hands are yours" : `Synth plays the ${info.hand === "left" ? "right" : "left"} hand`)),
        ),
        h(
          "p",
          { class: `piece-result${this.result ? ` piece-result-${this.result.tone}` : ""}`, role: "status" },
          this.statusText(),
        ),
        scroller,
      ),
    );
    const bars = info.xmlBars;
    void view.show(scoreXml(record.xml, bars), piece, bars?.from ?? 0);
  }

  /** The last pass's result, with the live marker while passes run. */
  private statusText(): string {
    const idle = `Press Start, Space or ${midiNoteName(this.deps.startKey())} to play. It repeats until you stop.`;
    if (!this.looping) return this.result?.text ?? idle;
    return this.result ? `● Live · last: ${this.result.text}` : "● Live";
  }

  private placeName(place: Place): string {
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
      this.result = null;
    } else {
      this.looping = true;
      this.result = null;
      this.justPassed = null;
      this.startPass();
    }
    this.refreshPractice();
  }

  /** Redraws the practice screen's controls without reloading the score. */
  private refreshPractice(): void {
    if (this.screen.name !== "practice") return;
    const page = this.root.querySelector(".piece-practice");
    const start = page?.querySelector<HTMLButtonElement>(".piece-start");
    if (start) start.textContent = this.looping ? "Stop" : "Start";
    const result = page?.querySelector<HTMLElement>(".piece-result");
    if (result) {
      result.className = `piece-result${this.result ? ` piece-result-${this.result.tone}` : ""}`;
      result.textContent = this.statusText();
    }
  }

  private startPass(): void {
    if (this.screen.name !== "practice" || !this.open || !this.view) return;
    const place = this.screen.place;
    const info = this.placeOf(place);
    const { piece, record } = this.open;
    const span = playSpan(piece, info.order, info.hand);
    const beats = piece.measures[info.order[0]].beats;
    const session = new PieceSession(span, info.tempo, beats);
    const now = performance.now();
    session.arm(now);
    const beatMs = 60_000 / info.tempo;
    this.metronome.start(info.tempo, record.settings.metronome ? beats + Math.ceil(span.length) : beats, now, beats);
    const timers: number[] = [];
    if (record.settings.otherHand && info.hand !== "both") {
      for (const other of span.others) {
        const at = session.start! + other.due * beatMs;
        timers.push(window.setTimeout(() => this.deps.synth.play(other.pitch, 0.55, Math.max(0.1, other.length * beatMs * 0.9) / 1000), Math.max(0, at - performance.now())));
      }
    }
    this.view.clearMarks();
    // The other hand of the pass before may still be sounding out; this one takes over.
    for (const timer of this.soundTimers) clearTimeout(timer);
    this.soundTimers = timers;
    const pass: Pass = { session, span, frame: 0, slot: -1 };
    this.pass = pass;
    this.refreshPractice();
    const step = () => {
      if (this.pass !== pass) return;
      const time = performance.now();
      for (const index of session.tick(time)) this.mark(index, "wrong");
      this.follow(pass, time);
      // Every note played or gone: a moment to see the last ones coloured, then the result.
      pass.doneAt ??= session.done ? time : undefined;
      if (pass.doneAt !== undefined && time >= pass.doneAt + PASS_TAIL_MS) {
        this.finishPass(pass);
        return;
      }
      pass.frame = requestAnimationFrame(step);
    };
    pass.frame = requestAnimationFrame(step);
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
    this.view?.markPhrases([], { from: measure, to: measure });
    if (this.scroller) this.view?.scrollToBar(measure, this.scroller);
  }

  private mark(index: number, mark: NoteMark): void {
    const target = this.pass?.session.targets[index];
    if (target) this.view?.setMark(target.notes, mark);
  }

  private onNote(event: NoteEvent): void {
    if (!this.visible || event.source !== "midi") return;
    if (event.pitch === this.deps.startKey()) {
      if (event.kind === "on") this.toggle();
      return;
    }
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
    const result = pass.session.result();
    const { record, phrases } = this.open;
    const before = this.progressAt(place);
    const after = recordPass(before, result.clean, info.streak, info.misses, Date.now());
    record.progress =
      place.kind === "full" ? { ...record.progress, full: after } : withStep(record.progress, phrases[place.phrase], place.step, after);
    this.save();
    const newlyPassed = before?.passedAt === undefined && after.passedAt !== undefined;
    this.result = this.passMessage(result, after, info.streak, pass.span, newlyPassed, place.kind === "full");
    if (newlyPassed) {
      this.looping = false;
      this.justPassed = place;
      this.metronome.stop();
      // Redraw for the next-step button; the passed pass's colours go with it.
      const keep = this.result;
      this.renderPractice(place);
      this.result = keep;
      this.refreshPractice();
      return;
    }
    this.refreshStreak(after, info.streak);
    this.refreshPractice();
    if (this.looping) this.nextPassTimer = window.setTimeout(() => this.looping && this.startPass(), PASS_GAP_MS);
  }

  private refreshStreak(progress: StepProgress, streak: number): void {
    const row = this.root.querySelector(".piece-status .score-dots");
    row?.replaceWith(dots(streakMarks(progress, streak)));
  }

  private passMessage(
    result: PassResult,
    progress: StepProgress,
    streak: number,
    span: PlaySpan,
    passed: boolean,
    full: boolean,
  ): { text: string; tone: "perfect" | "fault" | "info" } {
    const hits = streakMarks(progress, streak).filter((m) => m === "correct").length;
    if (passed && full) return { text: "🏆 The whole piece, clean at tempo", tone: "perfect" };
    if (passed) return { text: `🌟 Step passed · ${hits}/${streak}`, tone: "perfect" };
    if (result.clean) return { text: `✨ Clean · ${hits}/${streak}`, tone: "perfect" };
    const fault = result.fault;
    if (!fault) return { text: `❌ Not quite · ${hits}/${streak}`, tone: "fault" };
    const bar = this.open!.piece.measures[span.order[fault.slot]].label;
    return { text: `${FAULT_EMOJI[fault.kind]} ${FAULT_TEXT[fault.kind]} in bar ${bar} · ${result.hits}/${result.total} notes · ${hits}/${streak}`, tone: "fault" };
  }

  private clearPass(): void {
    const pass = this.pass;
    if (!pass) return;
    cancelAnimationFrame(pass.frame);
    this.pass = null;
  }

  private stop(): void {
    this.looping = false;
    clearTimeout(this.nextPassTimer);
    this.clearPass();
    for (const timer of this.soundTimers) clearTimeout(timer);
    this.soundTimers = [];
    this.metronome.stop();
  }
}

function samePlace(a: Place, b: Place): boolean {
  if (a.kind === "full" || b.kind === "full") return a.kind === b.kind;
  return a.phrase === b.phrase && stepKey(a.step) === stepKey(b.step);
}
