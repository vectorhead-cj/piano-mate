import {
  CHAPTERS,
  CLEF_TRACKS,
  COMPLETE_STREAK,
  PLACED_STAGES,
  STAR_STREAK,
  TIER_LABELS,
  TIERS,
  TRACK_LABELS,
  hasIntro,
  keyFullName,
  placedStage,
  stageFacts,
  stageNewKeys,
  stageTitle,
  tierTempo,
  type Tier,
} from "../curriculum/curriculum";
import type { IntroStep } from "../curriculum/intros";
import type { Progress, StageProgress } from "../curriculum/progress";
import { NOTATION_LABELS } from "../music/notation";
import type { StoreStatus } from "../curriculum/progressStore";
import type { Clef } from "../music/types";

type Child = Node | string | null | undefined | false;

/** Small element builder: h("div", {class: "x"}, child, ...). */
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
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

function stars(count: number, of = 3): HTMLElement {
  return h(
    "span",
    { class: "stars", "aria-label": `${count} of ${of} stars` },
    ...Array.from({ length: of }, (_, i) => h("span", { class: i < count ? "star on" : "star" }, "★")),
  );
}

function meter(value: number, max: number, label: string): HTMLElement {
  const fill = h("span", { class: "meter-fill" });
  fill.style.width = `${Math.min(100, (value / max) * 100)}%`;
  return h("span", { class: "meter", role: "img", "aria-label": label }, fill);
}

export interface HomeModel {
  progress: Progress;
  status: StoreStatus;
  storage: "account" | "browser" | "none" | null;
}

export interface HomeActions {
  openTrack(clef: Clef): void;
  openCustom(): void;
}

export function renderHome(root: HTMLElement, model: HomeModel, actions: HomeActions): void {
  const total = PLACED_STAGES.length;
  const tracks = CLEF_TRACKS.map((clef) => {
    const track = model.progress[clef];
    const current = placedStage(track.currentStageId)!;
    const currentProgress = track.stages[current.stage.id];
    const subtitle =
      currentProgress.introOpen && !currentProgress.introDone
        ? `Intro to ${current.number} · ${introTitle(current.stage.id)}`
        : `Stage ${current.number} · ${stageTitle(current.stage)}`;
    const button = h("button", { class: "btn-primary", type: "button" }, track.passed === 0 ? "Start" : "Continue");
    button.addEventListener("click", () => actions.openTrack(clef));
    return h(
      "article",
      { class: "menu-card" },
      h("h2", { class: "menu-card-title" }, `${TRACK_LABELS[clef]} track`),
      h("p", { class: "menu-card-sub" }, subtitle),
      meter(track.passed, total, `${track.passed} of ${total} stages passed`),
      h(
        "div",
        { class: "menu-card-foot" },
        h("span", { class: "menu-muted" }, `${track.passed} of ${total} stages passed`),
        button,
      ),
    );
  });

  const customButton = h("button", { class: "btn-secondary", type: "button" }, "Open");
  customButton.addEventListener("click", actions.openCustom);
  const custom = h(
    "article",
    { class: "menu-card" },
    h("h2", { class: "menu-card-title" }, "Custom"),
    h("p", { class: "menu-card-sub" }, "Free practice with any settings"),
    h("p", { class: "menu-muted" }, "Logged, not scored"),
    h("div", { class: "menu-card-foot menu-card-foot-end" }, customButton),
  );

  const note =
    model.status === "loading"
      ? "Loading your progress…"
      : model.status === "save-failed"
        ? "Some practice couldn't be saved. It's kept until you close this page."
        : model.storage === "none"
          ? "Progress isn't stored on the dev server. Only phrases played on a MIDI keyboard would count."
          : model.storage === "account"
          ? "Progress is saved to your Claude account. Only phrases played on a MIDI keyboard count."
          : "Progress is saved in this browser. Only phrases played on a MIDI keyboard count.";

  root.replaceChildren(
    h("div", { class: "menu-grid" }, ...tracks, custom),
    h("p", { class: "menu-note", role: "status" }, note),
  );
}

export interface TrackActions {
  select(stageId: string): void;
  start(stageId: string, tier: Tier): void;
  intro(stageId: string): void;
  /** Open the track up to this stage, for someone who knows what comes before. */
  startHere(stageId: string): void;
}

function stageStatus(progress: StageProgress): { text: string; tone: string } {
  if (!progress.unlocked) return { text: "Locked", tone: "locked" };
  if (progress.complete) return { text: "Complete", tone: "done" };
  if (progress.stars >= 2) return { text: "Passed", tone: "passed" };
  const tier: Tier = progress.stars === 0 ? "read" : "play";
  return { text: `${progress.tiers[tier].streak} / ${STAR_STREAK}`, tone: "current" };
}

export function renderTrack(
  root: HTMLElement,
  clef: Clef,
  progress: Progress,
  selectedStageId: string,
  actions: TrackActions,
): void {
  const track = progress[clef];
  const chapters = CHAPTERS.map((chapter, chapterIndex) => {
    const placed = PLACED_STAGES.filter((p) => p.chapterIndex === chapterIndex);
    const passed = placed.filter((p) => track.stages[p.stage.id].stars >= 2).length;
    const rows = placed.flatMap((p) => {
      const stageProgress = track.stages[p.stage.id];
      const status = stageStatus(stageProgress);
      const selected = p.stage.id === selectedStageId;
      const row = h(
        "button",
        {
          class: "stage-row",
          type: "button",
          "aria-expanded": selected ? "true" : "false",
          "data-tone": status.tone,
        },
        h("span", { class: "stage-number" }, p.number),
        h("span", { class: "stage-title" }, stageTitle(p.stage)),
        stars(stageProgress.stars),
        h("span", { class: "stage-status" }, status.text),
      );
      row.addEventListener("click", () => actions.select(p.stage.id));
      const intro = hasIntro(p.stage) ? [introRow(p.stage.id, p.number, stageProgress, actions)] : [];
      if (!selected) return [...intro, row];
      const detail = stageProgress.unlocked || stageProgress.introOpen
        ? stageDetail(p.stage.id, stageProgress, actions)
        : lockedDetail(p.stage.id, p.number, actions);
      return [...intro, row, detail];
    });
    return h(
      "section",
      { class: "chapter" },
      h(
        "header",
        { class: "chapter-head" },
        h("h2", { class: "chapter-title" }, `Chapter ${chapterIndex + 1} · ${chapter.title}`),
        h("span", { class: "menu-muted" }, `${passed} of ${placed.length} passed`),
      ),
      ...rows,
    );
  });
  root.replaceChildren(
    h("h1", { class: "menu-heading" }, `${TRACK_LABELS[clef]} track`),
    h("p", { class: "menu-note" }, `${track.passed} of ${PLACED_STAGES.length} stages passed · ${track.completed} complete`),
    ...chapters,
  );
  root.querySelector('[aria-expanded="true"]')?.scrollIntoView({ block: "nearest" });
}

function listText(items: readonly string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0];
}

/** "Quarter notes, half notes, whole notes and the C major scale" */
export function introTitle(stageId: string): string {
  const { stage } = placedStage(stageId)!;
  // Lower-case notation names after the first, but not "3/4 time" or "Cut time (2/2)"'s capitals mid-name.
  const notations = stage.introduces.map((n) => NOTATION_LABELS[n].replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase()));
  const keys = stageNewKeys(stage).map(keyFullName);
  const scales = keys.length > 0 ? [`the ${listText(keys)} scale${keys.length > 1 ? "s" : ""}`] : [];
  const title = listText([...notations, ...scales]);
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** The intro before a stage with new notation; the stage opens once it's done, and it can be replayed. */
function introRow(stageId: string, number: string, progress: StageProgress, actions: TrackActions): HTMLElement {
  const status = !progress.introOpen
    ? { text: "Locked", tone: "locked" }
    : progress.introDone
      ? { text: "Replay", tone: "passed" }
      : { text: "Start", tone: "current" };
  const row = h(
    "button",
    { class: "stage-row intro-row", type: "button", "data-tone": status.tone, disabled: !progress.introOpen },
    h("span", { class: "stage-number" }, "\u266A"),
    h("span", { class: "stage-title" }, h("span", { class: "intro-row-label" }, `Intro to ${number}`), introTitle(stageId)),
    // Intros earn no stars; keep the status in its column.
    h("span", { "aria-hidden": "true" }),
    h("span", { class: "stage-status" }, status.text),
  );
  row.addEventListener("click", () => actions.intro(stageId));
  return row;
}

const TIER_HINTS: Record<Tier, string> = {
  read: "Wait mode",
  play: "Rhythm mode",
  fluent: "Rhythm, faster",
};

function stageDetail(stageId: string, progress: StageProgress, actions: TrackActions): HTMLElement {
  const { stage } = placedStage(stageId)!;
  const tiers = TIERS.map((tier, i) => {
    const tierProgress = progress.tiers[tier];
    const open = progress.tierOpen[tier];
    const earned = progress.stars > i;
    const tempo = tierTempo(stage, tier);
    const button = h(
      "button",
      { class: earned || !open ? "btn-secondary" : "btn-primary", type: "button", disabled: !open },
      open ? `Start ${TIER_LABELS[tier]}` : "Locked",
    );
    button.addEventListener("click", () => actions.start(stageId, tier));
    return h(
      "div",
      { class: "tier-card", "data-open": open ? "true" : "false" },
      h("div", { class: "tier-card-head" }, stars(i + 1, i + 1), h("span", { class: "tier-name" }, TIER_LABELS[tier])),
      h("span", { class: "menu-muted" }, tempo ? `${TIER_HINTS[tier]} · ${tempo} bpm` : TIER_HINTS[tier]),
      h(
        "span",
        { class: "menu-muted" },
        earned ? `Earned · best ${tierProgress.best} in a row` : `${tierProgress.streak} / ${STAR_STREAK} in a row`,
      ),
      button,
    );
  });
  const best = Math.max(progress.tiers.play.best, progress.tiers.fluent.best);
  return h(
    "div",
    { class: "stage-detail" },
    h("div", { class: "chips" }, ...stageFacts(stage).map((fact) => h("span", { class: "chip" }, fact))),
    h("div", { class: "tier-grid" }, ...tiers),
    h(
      "div",
      { class: "complete-row" },
      h(
        "span",
        { class: "menu-muted" },
        progress.complete
          ? "Stage complete"
          : `Complete: ${COMPLETE_STREAK} in a row at Play or Fluent · best ${best}`,
      ),
      meter(best, COMPLETE_STREAK, `Best ${best} of ${COMPLETE_STREAK}`),
    ),
  );
}

/** A locked stage: what it holds, and the choice to start the track here instead. */
function lockedDetail(stageId: string, number: string, actions: TrackActions): HTMLElement {
  const { stage } = placedStage(stageId)!;
  const button = h("button", { class: "btn-secondary", type: "button" }, "Start here");
  button.addEventListener("click", () => actions.startHere(stageId));
  return h(
    "div",
    { class: "stage-detail" },
    h("div", { class: "chips" }, ...stageFacts(stage).map((fact) => h("span", { class: "chip" }, fact))),
    h(
      "div",
      { class: "start-here" },
      h("span", { class: "menu-muted" }, `Already know what comes before? Open every stage up to ${number}; their stars stay unearned.`),
      button,
    ),
  );
}

export interface PracticeBarModel {
  clef: Clef;
  stageId: string;
  tier: Tier;
  progress: StageProgress;
  midiReady: boolean;
}

export function renderPracticeBar(root: HTMLElement, model: PracticeBarModel, onTier: (tier: Tier) => void): void {
  const placed = placedStage(model.stageId)!;
  const tiers = TIERS.map((tier, i) => {
    const open = model.progress.tierOpen[tier];
    const button = h(
      "button",
      {
        type: "button",
        class: "tier-tab",
        "aria-pressed": tier === model.tier ? "true" : "false",
        disabled: !open,
        title: open ? undefined : `Earn ${"★".repeat(i)} first`,
      },
      `${"★".repeat(i + 1)} ${TIER_LABELS[tier]}`,
    );
    button.addEventListener("click", () => onTier(tier));
    return button;
  });
  const tempo = tierTempo(placed.stage, model.tier);
  root.replaceChildren(
    h(
      "div",
      { class: "practice-bar-title" },
      h("span", { class: "practice-bar-number" }, `${TRACK_LABELS[model.clef]} ${placed.number}`),
      h("span", { class: "practice-bar-name" }, stageTitle(placed.stage)),
      stars(model.progress.stars),
    ),
    h("div", { class: "tier-tabs", role: "group", "aria-label": "Tier" }, ...tiers),
    h(
      "span",
      { class: model.midiReady ? "menu-muted" : "practice-bar-warning" },
      model.midiReady
        ? tempo
          ? `${tempo} bpm`
          : "Wait mode"
        : "Connect a MIDI keyboard to earn progress; screen keys are practice only",
    ),
  );
}

export interface IntroModel {
  clef: Clef;
  stageId: string;
  steps: readonly IntroStep[];
  index: number;
  /** Watched again after it was done; leaving it goes back to the track. */
  replay: boolean;
}

export interface IntroActions {
  listen(): void;
  skip(): void;
}

/** The card above the staff while an intro runs: what the example shows and how to count it. */
export function renderIntro(root: HTMLElement, model: IntroModel, actions: IntroActions): void {
  const placed = placedStage(model.stageId)!;
  const step = model.steps[model.index];
  const last = model.index === model.steps.length - 1;
  const listen = h("button", { class: "btn-primary", type: "button" }, "▶ Listen");
  listen.addEventListener("click", () => {
    // Leave Space free to start an attempt rather than replaying.
    listen.blur();
    actions.listen();
  });
  const skip = h("button", { class: "btn-secondary", type: "button" }, model.replay ? "Back to the track" : last ? "Skip to the stage" : "Skip intro");
  skip.addEventListener("click", actions.skip);
  const count = step.count ? [h("p", { class: "intro-count" }, h("span", { class: "intro-count-label" }, "Count"), step.count)] : [];
  root.replaceChildren(
    h(
      "div",
      { class: "intro-head" },
      h("span", { class: "intro-kicker" }, `${TRACK_LABELS[model.clef]} ${placed.number} · intro · ${model.index + 1} of ${model.steps.length}`),
      skip,
    ),
    h("h2", { class: "intro-title" }, step.title),
    h("p", { class: "intro-text" }, step.text),
    ...count,
    h(
      "div",
      { class: "intro-foot" },
      listen,
      h("span", { class: "menu-muted" }, "Then press Start (or Space) and play it back."),
    ),
  );
}

export type ResultTone = "perfect" | "fault" | "info" | "milestone";

/** Shows a short message over the notation after each phrase. */
export class PhraseResultBanner {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly root: HTMLElement) {}

  show(text: string, tone: ResultTone, ms = 2400): void {
    clearTimeout(this.timer);
    this.root.textContent = text;
    this.root.dataset.tone = tone;
    this.root.hidden = false;
    this.timer = setTimeout(() => this.hide(), ms);
  }

  hide(): void {
    clearTimeout(this.timer);
    this.root.hidden = true;
  }
}
