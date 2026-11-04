import { keyFullName } from "../curriculum/curriculum";
import { cardNoteHits, cardOutcome, newId, spellingText, type CardAnswered, type InputKind } from "../curriculum/events";
import type { ProgressStore } from "../curriculum/progressStore";
import type { NoteStream } from "../input/noteStream";
import { attachScreenInput } from "../input/screenInput";
import type { Synth } from "../audio/synth";
import type { Random } from "../music/generator";
import type { NoteSource } from "../music/types";
import { KeyboardView } from "../render/keyboardView";
import { NotationView } from "../render/notationView";
import { generateCard, type Card } from "./cardGenerator";
import { conceptTitle, unlockedConcepts } from "./concepts";
import { EMPTY_ENTRY, placesByPitch, press, type Entry } from "./entry";
import {
  buildQueue,
  dueCounts,
  dueText,
  nextCard,
  scheduleConcepts,
  whenText,
  type DueCounts,
  type NextCard,
  type Queue,
} from "./scheduler";

/** A white key on screen is never narrower than this (CSS pixels): it sets how much of a range a card draws on. */
const MIN_KEY_PX = 40;
/** Milliseconds between the notes when a card's answer is played back. */
const HEAR_NOTE_MS = 600;
const KIND_LABELS: Record<NextCard["kind"], string> = { new: "New", learning: "Learning", review: "Review" };

/** What the home page says about the flashcards: how many are up, and whether any are unlocked. */
export interface FlashcardSummary {
  counts: DueCounts;
  unlocked: number;
}

export function flashcardSummary(store: ProgressStore, now = Date.now()): FlashcardSummary {
  const unlocked = unlockedConcepts(store.progress, store.allUnlocked);
  return { counts: dueCounts(buildQueue(unlocked, scheduleConcepts(store.history), now)), unlocked: unlocked.length };
}

export interface FlashcardDeps {
  /** The view's own markup (index.html). */
  root: HTMLElement;
  stream: NoteStream;
  synth: Synth;
  store: ProgressStore;
  /** One page load, as the other events carry. */
  session: string;
  /** Whether keys played on a MIDI device also sound on the synth (the device usually has its own). */
  soundMidiKeys: () => boolean;
  openCurriculum: () => void;
  random?: Random;
  now?: () => number;
}

type State =
  | { kind: "empty" }
  | { kind: "done"; queue: Queue }
  | { kind: "asking"; card: Card; next: NextCard; shownAt: number; entry: Entry; sources: Set<NoteSource> }
  | { kind: "answered"; card: Card; next: NextCard; event: CardAnswered; consequence: string };

function element<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector} in the flashcards markup`);
  return found;
}

function inputKind(sources: ReadonlySet<NoteSource>): InputKind {
  if (sources.size === 0 || !sources.has("midi")) return "screen";
  return sources.has("screen") ? "mixed" : "midi";
}

/**
 * Flashcards: one bar of four quarter notes with its clef, key and time, numbered 1 to 4, and a
 * keyboard to answer on. The player presses the keys in the order of the notes; each key says
 * which place it holds. Pressing a key again takes it out. Answer marks the whole bar at once,
 * and an empty answer is "I don't know". Which concept comes up, and when, is the scheduler's
 * (see scheduler.ts); the answer is logged as an event and the schedule is folded from the log.
 */
export class FlashcardMode {
  private readonly notation: NotationView;
  private readonly keyboard: KeyboardView;
  private readonly status: HTMLElement;
  private readonly message: HTMLElement;
  private readonly feedback: HTMLElement;
  private readonly keyboardElement: HTMLElement;
  private readonly secondary: HTMLButtonElement;
  private readonly primary: HTMLButtonElement;
  private readonly random: Random;
  private readonly now: () => number;
  private active = false;
  private state: State = { kind: "empty" };
  private hearing: ReturnType<typeof setTimeout>[] = [];

  constructor(private readonly deps: FlashcardDeps) {
    const { root } = deps;
    this.random = deps.random ?? Math.random;
    this.now = deps.now ?? Date.now;
    this.status = element(root, "[data-flashcard-status]");
    this.message = element(root, "[data-flashcard-message]");
    this.feedback = element(root, "[data-flashcard-feedback]");
    this.keyboardElement = element(root, "[data-flashcard-keyboard]");
    this.secondary = element(root, "[data-flashcard-secondary]");
    this.primary = element(root, "[data-flashcard-primary]");
    this.notation = new NotationView(element(root, "[data-flashcard-notation]"));
    this.notation.setNumbers(true);
    this.keyboard = new KeyboardView(this.keyboardElement);

    attachScreenInput(this.keyboardElement, deps.stream);
    this.keyboardElement.addEventListener("pointerdown", () => deps.synth.unlock(), { capture: true });
    deps.stream.subscribe((event) => this.onNote(event.kind, event.pitch, event.source, event.velocity));
    this.secondary.addEventListener("click", () => this.onSecondary());
    this.primary.addEventListener("click", () => this.onPrimary());
    document.addEventListener("keydown", (event) => this.onKey(event));
    new ResizeObserver(() => this.active && this.notation.draw()).observe(element(root, ".notation-sheet"));
  }

  /** The view has been shown: bring up the next card. */
  show(): void {
    this.active = true;
    this.advance();
  }

  hide(): void {
    this.active = false;
    this.stopHearing();
  }

  // --- Which card -------------------------------------------------------------------------

  /** Works out what is due now and shows it: the next card, or why there isn't one. */
  private advance(): void {
    this.stopHearing();
    const now = this.now();
    const unlocked = unlockedConcepts(this.deps.store.progress, this.deps.store.allUnlocked);
    if (unlocked.length === 0) {
      this.state = { kind: "empty" };
    } else {
      const queue = buildQueue(unlocked, scheduleConcepts(this.deps.store.history), now);
      const next = nextCard(queue);
      this.state = next
        ? {
            kind: "asking",
            card: generateCard(next.concept, Math.floor(this.keyboardElement.clientWidth / MIN_KEY_PX), this.random),
            next,
            shownAt: now,
            entry: EMPTY_ENTRY,
            sources: new Set(),
          }
        : { kind: "done", queue };
    }
    this.render();
  }

  // --- Input ------------------------------------------------------------------------------

  private onNote(kind: "on" | "off", pitch: number, source: NoteSource, velocity?: number): void {
    if (!this.active) return;
    if (kind === "off") {
      this.keyboard.setPressed(pitch, false);
      return;
    }
    const state = this.state;
    // A MIDI key that isn't on the drawn keyboard has no place to show; the card isn't about it.
    const { lowest, highest } = this.keyboard.visibleRange;
    if (state.kind !== "asking" || pitch < lowest || pitch > highest) return;
    this.keyboard.setPressed(pitch, true);
    const { entry, change } = press(state.entry, pitch, state.card.pitches.length);
    if (change === "full") {
      this.keyboard.flash(pitch, "wrong");
      this.say(`All ${state.card.pitches.length} notes are in. Answer, or press a numbered key to take it out.`);
      return;
    }
    if (change === "added" && (source !== "midi" || this.deps.soundMidiKeys())) this.deps.synth.play(pitch, velocity);
    if (change === "added") state.sources.add(source);
    state.entry = entry;
    this.say("");
    this.renderEntry();
    this.renderButtons();
  }

  private onKey(event: KeyboardEvent): void {
    if (!this.active || event.repeat) return;
    if ((event.target as Element).closest("button, input, select, textarea, [contenteditable]")) return;
    if (event.key === "Enter") {
      event.preventDefault();
      this.onPrimary();
    } else if (event.key === "Escape" && this.state.kind === "asking") {
      event.preventDefault();
      this.onSecondary();
    }
  }

  /** Start fresh, or, with the answer shown, hear it. */
  private onSecondary(): void {
    const state = this.state;
    if (state.kind === "asking") {
      state.entry = EMPTY_ENTRY;
      state.sources.clear();
      this.say("");
      this.renderEntry();
      this.renderButtons();
    } else if (state.kind === "answered") {
      this.hear(state.card);
    }
  }

  /** Answer; with nothing entered, "I don't know"; once answered, on to the next card. */
  private onPrimary(): void {
    const state = this.state;
    if (state.kind === "asking") this.answer(state);
    else if (state.kind === "answered") this.advance();
    else if (state.kind === "empty") this.deps.openCurriculum();
  }

  private answer(state: Extract<State, { kind: "asking" }>): void {
    const { card } = state;
    const at = this.now();
    const event: CardAnswered = {
      type: "card-answered",
      v: 1,
      id: newId(),
      at,
      startedAt: state.shownAt,
      session: this.deps.session,
      concept: card.concept.id,
      clef: card.concept.clef,
      key: card.concept.key,
      time: card.exercise.time,
      notes: card.exercise.bars[0].map(spellingText),
      answer: [...state.entry.pressed],
      input: inputKind(state.sources),
    };
    this.deps.store.record(event);
    const schedule = scheduleConcepts(this.deps.store.history).get(card.concept.id);
    this.state = { kind: "answered", card, next: state.next, event, consequence: schedule ? dueText(schedule, at) : "" };
    this.render();
  }

  // --- Output -----------------------------------------------------------------------------

  private say(text: string): void {
    this.feedback.textContent = text;
  }

  private render(): void {
    const { state } = this;
    this.deps.root.dataset.state = state.kind;
    this.renderStatus();
    this.message.replaceChildren();
    if (state.kind === "empty") this.renderEmpty();
    else if (state.kind === "done") this.renderDone(state.queue);
    else this.renderCard(state);
    this.renderButtons();
  }

  private renderStatus(): void {
    const { state } = this;
    const queue = state.kind === "done" ? state.queue : this.currentQueue();
    const counts = queue ? dueCounts(queue) : null;
    const concept = state.kind === "asking" || state.kind === "answered" ? state.card.concept : null;
    const next = state.kind === "asking" || state.kind === "answered" ? state.next : null;
    const title = document.createElement("div");
    title.className = "flashcard-concept";
    if (concept && next) {
      const kind = document.createElement("span");
      kind.className = "flashcard-kind";
      kind.dataset.kind = next.kind;
      kind.textContent = KIND_LABELS[next.kind];
      const text = document.createElement("span");
      text.textContent = conceptTitle(concept, keyFullName);
      title.append(kind, text);
    } else {
      title.textContent = "Flashcards";
    }
    const tally = document.createElement("div");
    tally.className = "flashcard-counts";
    tally.setAttribute("aria-label", "Cards due");
    if (counts) {
      for (const [name, label] of [["new", "New"], ["learning", "Learning"], ["review", "Review"]] as const) {
        const item = document.createElement("span");
        item.dataset.kind = name;
        item.title = `${label} cards`;
        item.textContent = String(counts[name]);
        tally.append(item);
      }
    }
    this.status.replaceChildren(title, tally);
  }

  /** What is due as things stand, with the card on the table counted. */
  private currentQueue(): Queue | null {
    const unlocked = unlockedConcepts(this.deps.store.progress, this.deps.store.allUnlocked);
    return unlocked.length === 0 ? null : buildQueue(unlocked, scheduleConcepts(this.deps.store.history), this.now());
  }

  private renderEmpty(): void {
    this.message.append(
      this.paragraph("No flashcards yet", "flashcard-message-title"),
      this.paragraph("They open as you go through the curriculum: finish the intro to a stage, and its notes and keys come up here."),
    );
    this.say("");
  }

  private renderDone(queue: Queue): void {
    const when = queue.nextAt === null ? "" : `The next card comes up ${whenText(this.now(), queue.nextAt)}.`;
    this.message.append(this.paragraph("All done for now", "flashcard-message-title"), this.paragraph(when || "Nothing is due."));
    this.say("");
  }

  private paragraph(text: string, className?: string): HTMLParagraphElement {
    const p = document.createElement("p");
    if (className) p.className = className;
    p.textContent = text;
    return p;
  }

  private renderCard(state: Extract<State, { kind: "asking" | "answered" }>): void {
    const { card } = state;
    if (state.kind === "asking") {
      this.notation.show(card.exercise, { showNames: false });
      this.keyboard.setRange(card.window.lowest, card.window.highest);
      this.say("");
      this.renderEntry();
      return;
    }
    this.keyboard.clearAnnotations();
    const hits = cardNoteHits(state.event);
    hits.forEach((hit, i) => this.notation.setState(i, hit ? "correct" : "wrong"));
    // The answer on the keys: each note's key with its place, and any key pressed that was no note's.
    card.pitches.forEach((pitch, i) => {
      this.keyboard.setBadge(pitch, String(i + 1));
      this.keyboard.setMark(pitch, hits[i] ? "correct" : "missed");
    });
    for (const [pitch, place] of placesByPitch({ pressed: state.event.answer })) {
      if (card.pitches.includes(pitch)) continue;
      this.keyboard.setBadge(pitch, String(place));
      this.keyboard.setMark(pitch, "wrong");
    }
    const outcome = cardOutcome(state.event);
    const right = hits.filter(Boolean).length;
    const result =
      outcome === "correct"
        ? "Correct"
        : outcome === "unknown"
          ? "Here is the answer"
          : `${right} of ${hits.length} right`;
    this.say(`${result} · back ${state.consequence}`);
    this.feedback.dataset.outcome = outcome;
  }

  /** The answer so far, as numbers on the keys. */
  private renderEntry(): void {
    const { state } = this;
    if (state.kind !== "asking") return;
    this.keyboard.clearAnnotations();
    for (const [pitch, place] of placesByPitch(state.entry)) {
      this.keyboard.setBadge(pitch, String(place));
      this.keyboard.setMark(pitch, null);
    }
    delete this.feedback.dataset.outcome;
  }

  private renderButtons(): void {
    const { state } = this;
    if (state.kind === "asking") {
      this.secondary.textContent = "Start fresh";
      this.secondary.disabled = state.entry.pressed.length === 0;
      this.primary.textContent = state.entry.pressed.length === 0 ? "I don't know" : "Answer";
      this.primary.dataset.mode = state.entry.pressed.length === 0 ? "unknown" : "answer";
    } else if (state.kind === "answered") {
      this.secondary.textContent = "Hear it";
      this.secondary.disabled = false;
      this.primary.textContent = "Next";
      this.primary.dataset.mode = "next";
    } else {
      this.primary.textContent = state.kind === "empty" ? "Open curriculum" : "Done";
      this.primary.dataset.mode = "next";
    }
    this.primary.hidden = state.kind === "done";
  }

  // --- Hearing the answer -----------------------------------------------------------------

  private hear(card: Card): void {
    this.deps.synth.unlock();
    this.stopHearing();
    card.pitches.forEach((pitch, i) => {
      this.hearing.push(
        setTimeout(() => {
          this.deps.synth.play(pitch, 0.8, (HEAR_NOTE_MS * 0.9) / 1000);
          this.keyboard.setPressed(pitch, true);
          this.notation.setState(i, "current");
        }, i * HEAR_NOTE_MS),
        setTimeout(() => {
          this.keyboard.setPressed(pitch, false);
          const state = this.state;
          if (state.kind === "answered") this.notation.setState(i, cardNoteHits(state.event)[i] ? "correct" : "wrong");
        }, i * HEAR_NOTE_MS + HEAR_NOTE_MS * 0.9),
      );
    });
  }

  private stopHearing(): void {
    for (const timer of this.hearing) clearTimeout(timer);
    this.hearing = [];
    for (let pitch = this.keyboard.visibleRange.lowest; pitch <= this.keyboard.visibleRange.highest; pitch++) {
      this.keyboard.setPressed(pitch, false);
    }
  }
}
