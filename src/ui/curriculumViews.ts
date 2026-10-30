import {
  CHAPTERS,
  CLEF_TRACKS,
  COMPLETE_STREAK,
  PLACED_STAGES,
  STAR_STREAK,
  TIER_LABELS,
  TIERS,
  TRACK_LABELS,
  placedStage,
  stageFacts,
  stageTitle,
  tierTempo,
  type Tier,
} from "../curriculum/curriculum";
import type { Progress, StageProgress } from "../curriculum/progress";
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
    const button = h("button", { class: "btn-primary", type: "button" }, track.passed === 0 ? "Start" : "Continue");
    button.addEventListener("click", () => actions.openTrack(clef));
    return h(
      "article",
      { class: "menu-card" },
      h("h2", { class: "menu-card-title" }, `${TRACK_LABELS[clef]} track`),
      h("p", { class: "menu-card-sub" }, `Stage ${current.number} · ${stageTitle(current.stage)}`),
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
          disabled: !stageProgress.unlocked,
        },
        h("span", { class: "stage-number" }, p.number),
        h("span", { class: "stage-title" }, stageTitle(p.stage)),
        stars(stageProgress.stars),
        h("span", { class: "stage-status" }, status.text),
      );
      row.addEventListener("click", () => actions.select(p.stage.id));
      return selected && stageProgress.unlocked ? [row, stageDetail(p.stage.id, stageProgress, actions)] : [row];
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
