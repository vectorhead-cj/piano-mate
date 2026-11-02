import {
  advanceStars,
  ADVANCE_TEXT,
  CHAPTERS,
  CLEF_TRACKS,
  MASTERY_ROUNDS,
  maxStars,
  MISS_WINDOW,
  PLACED_STAGES,
  TIER_LABELS,
  TRACK_LABELS,
  hasIntro,
  keyFullName,
  placedStage,
  stageFacts,
  stageNewKeys,
  stageTiers,
  stageTitle,
  tierTempo,
  type Stage,
  type Tier,
} from "../curriculum/curriculum";
import type { IntroStep } from "../curriculum/intros";
import { recentHits, type Milestone, type Progress, type StageProgress } from "../curriculum/progress";
import { NOTATION_LABELS } from "../music/notation";
import { midiNoteName } from "../music/pitch";
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

/** Mastery's mark, after the last star. */
export const MASTERY_SYMBOL = "♛";

/**
 * A stage's stars; with `mastered` given, mastery's mark follows them, lit once earned, so
 * every row has it in the same place.
 */
function stars(count: number, of: number, mastered?: boolean): HTMLElement {
  const label = `${count} of ${of} stars${mastered ? ", mastered" : ""}`;
  return h(
    "span",
    { class: "stars", "aria-label": label },
    ...Array.from({ length: of }, (_, i) => h("span", { class: i < count ? "star on" : "star" }, "★")),
    mastered === undefined ? null : h("span", { class: mastered ? "mastery-mark on" : "mastery-mark" }, MASTERY_SYMBOL),
  );
}

/** One pip per mastery round, filled as rounds are passed in a row. */
export function masteryPips(rounds: number): HTMLElement {
  return h(
    "span",
    { class: "mastery-pips", role: "img", "aria-label": `${rounds} of ${MASTERY_ROUNDS} mastery rounds` },
    ...Array.from({ length: MASTERY_ROUNDS }, (_, i) => h("span", { class: i < rounds ? "pip on" : "pip" })),
  );
}

/** What mastery takes, in a line. */
export const MASTERY_TEXT = `${MASTERY_ROUNDS} rounds of ${ADVANCE_TEXT.replace(" to advance", "")} in a row at Fluent`;

function meter(value: number, max: number, label: string): HTMLElement {
  const fill = h("span", { class: "meter-fill" });
  fill.style.width = `${Math.min(100, (value / max) * 100)}%`;
  return h("span", { class: "meter", role: "img", "aria-label": label }, fill);
}

export interface HomeModel {
  progress: Progress;
  status: StoreStatus;
  storage: "account" | "browser" | "none" | null;
  /** The signed-in player's email, or null when signed out. */
  account: string | null;
}

export interface HomeActions {
  openCurriculum(): void;
  openCustom(): void;
  signIn(): void;
  signOut(): void;
}

/** A stroked 24×24 icon; `body` is fixed SVG markup from this file. */
function icon(body: string): HTMLElement {
  const wrap = h("span", { class: "home-icon", "aria-hidden": "true" });
  wrap.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20">${body}</svg>`;
  return wrap;
}

const ICONS = {
  cloud: '<path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.2 4.5 4.5 0 0 0 7 18z" />',
  device: '<rect x="4" y="5" width="16" height="11" rx="2" /><path d="M9 20h6M12 16v4" />',
  flask: '<path d="M9 4h6M10 4v6l-5 8.5A1.5 1.5 0 0 0 6.3 21h11.4a1.5 1.5 0 0 0 1.3-2.5L14 10V4" />',
  alert: '<path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4.5M12 17.2v.1" />',
  keys: '<rect x="3" y="6" width="18" height="12" rx="1.5" /><path d="M8 6v7M12 6v7M16 6v7" />',
};

/** What the save panel says: where progress lives, and the sign-in action that goes with it. */
function storageStatus(model: HomeModel): { icon: string; tone: string; title: string; detail: string; action?: "signIn" | "signOut" } {
  if (model.status === "loading") return { icon: ICONS.cloud, tone: "quiet", title: "Loading your progress…", detail: "" };
  if (model.status === "save-failed") {
    return {
      icon: ICONS.alert,
      tone: "warn",
      title: "Some practice couldn't be saved",
      detail: "It's kept until you close this page.",
    };
  }
  const signAction = model.account ? "signOut" : "signIn";
  if (model.storage === "account") {
    return { icon: ICONS.cloud, tone: "good", title: "Saved to your account", detail: model.account ?? "", action: "signOut" };
  }
  if (model.storage === "none") {
    return {
      icon: ICONS.flask,
      tone: "warn",
      title: "Not saved on the dev server",
      // The dev server only uses the account with ?account in the URL.
      detail: model.account
        ? `Signed in as ${model.account}. Add ?account to the URL to save to it.`
        : "Add ?account to the URL and sign in to save to your account.",
      action: signAction,
    };
  }
  return {
    icon: ICONS.device,
    tone: "quiet",
    title: "Saved in this browser",
    // Sign-ups are off (supabase/config.toml), so only existing accounts can sign in.
    detail: "Piano Mate is in alpha, so new accounts aren't available yet. Already have one? Sign in to keep your progress on all your devices.",
    action: "signIn",
  };
}

export function renderHome(root: HTMLElement, model: HomeModel, actions: HomeActions): void {
  const total = PLACED_STAGES.length;
  const hands = CLEF_TRACKS.map((clef) => {
    const track = model.progress[clef];
    const current = placedStage(track.currentStageId)!;
    const currentProgress = track.stages[current.stage.id];
    const next =
      currentProgress.introOpen && !currentProgress.introDone
        ? `Intro to ${current.number} · ${introTitle(current.stage.id)}`
        : `Stage ${current.number} · ${stageTitle(current.stage)}`;
    return h(
      "div",
      { class: "home-hand" },
      h("span", { class: "home-eyebrow" }, TRACK_LABELS[clef]),
      h("span", { class: "home-hand-next" }, next),
      meter(track.passed, total, `${TRACK_LABELS[clef]}: ${track.passed} of ${total} stages passed`),
      h("span", { class: "menu-muted" }, `${track.passed} of ${total} stages passed`),
    );
  });
  const started = CLEF_TRACKS.some((clef) => model.progress[clef].passed > 0);
  const curriculumButton = h("button", { class: "btn-primary", type: "button" }, started ? "Continue" : "Start");
  curriculumButton.addEventListener("click", actions.openCurriculum);
  const curriculum = h(
    "article",
    { class: "menu-card home-choice" },
    h("h2", { class: "menu-card-title" }, "Curriculum"),
    h("p", { class: "menu-muted" }, `${CHAPTERS.length} chapters for each hand, from five notes to every key. Earn stars to move on.`),
    ...hands,
    h("div", { class: "menu-card-foot menu-card-foot-end" }, curriculumButton),
  );

  const customButton = h("button", { class: "btn-secondary", type: "button" }, "Open");
  customButton.addEventListener("click", actions.openCustom);
  const custom = h(
    "article",
    { class: "menu-card home-choice" },
    h("h2", { class: "menu-card-title" }, "Custom practice"),
    h("p", { class: "menu-muted" }, "Pick any key, range and rhythm, in either clef. Logged, not scored."),
    h("div", { class: "menu-card-foot menu-card-foot-end" }, customButton),
  );

  const status = storageStatus(model);
  let accountButton: HTMLButtonElement | null = null;
  if (status.action) {
    accountButton = h("button", { class: "btn-secondary", type: "button" }, status.action === "signOut" ? "Sign out" : "Sign in");
    accountButton.addEventListener("click", status.action === "signOut" ? actions.signOut : actions.signIn);
  }
  const statusPanel = h(
    "section",
    { class: `home-status home-status-${status.tone}`, role: "status", "aria-label": "Progress storage" },
    icon(status.icon),
    h(
      "div",
      { class: "home-status-text" },
      h("p", { class: "home-status-title" }, status.title),
      status.detail && h("p", { class: "menu-muted" }, status.detail),
    ),
    accountButton,
  );

  root.replaceChildren(
    h(
      "div",
      { class: "home" },
      h(
        "header",
        { class: "home-intro" },
        h("h1", { class: "home-title" }, "Read and play!"),
        h("p", { class: "home-lede" }, "Practice using real phrases from a large corpus of classical and folk music"),
      ),
      h("div", { class: "home-choices" }, curriculum, custom),
      h(
        "footer",
        { class: "home-foot" },
        statusPanel,
        h("p", { class: "home-hint" }, icon(ICONS.keys), "Only phrases played on a MIDI keyboard count toward progress."),
      ),
    ),
  );
}

export interface TrackActions {
  select(stageId: string): void;
  start(stageId: string, tier: Tier): void;
  intro(stageId: string): void;
  /** Open the track up to this stage, for someone who knows what comes before. */
  startHere(stageId: string): void;
}

/** A stage in one clef's track: which marker in the curriculum is open. */
export interface StageRef {
  clef: Clef;
  stageId: string;
}

/** The track actions, for whichever clef they're taken in. */
export type CurriculumActions = (clef: Clef) => TrackActions;

/** A stage's marker: ♛ mastered, ★ passed, the stage being worked on, its intro, or locked. */
function markerState(stageId: string, progress: StageProgress, currentStageId: string): string {
  if (progress.mastered) return "mastered";
  if (progress.unlocked && progress.stars >= advanceStars(placedStage(stageId)!.stage)) return "passed";
  if (stageId === currentStageId && (progress.unlocked || progress.introOpen)) return "current";
  if (progress.unlocked) return "open";
  return "locked";
}

const MARKER_STATE_TEXT: Record<string, string> = {
  mastered: "mastered",
  passed: "passed",
  current: "up next",
  open: "open",
  locked: "locked",
};

/** One clef's side of a chapter: a marker per stage, and a line on where that clef stands. */
function chapterSide(
  clef: Clef,
  chapterIndex: number,
  progress: Progress,
  selected: StageRef | null,
  select: (ref: StageRef) => void,
): HTMLElement {
  const track = progress[clef];
  const placed = PLACED_STAGES.filter((p) => p.chapterIndex === chapterIndex);
  const markers = placed.map((p) => {
    const stageProgress = track.stages[p.stage.id];
    const state = markerState(p.stage.id, stageProgress, track.currentStageId);
    const introNext = state === "current" && stageProgress.introOpen && !stageProgress.introDone;
    const marker = h(
      "button",
      {
        class: "stage-marker",
        type: "button",
        "data-state": state,
        "aria-expanded": selected?.clef === clef && selected.stageId === p.stage.id ? "true" : "false",
        "aria-label": `${TRACK_LABELS[clef]} ${p.number}, ${stageTitle(p.stage)}, ${stageProgress.stars} of ${maxStars(p.stage)} stars, ${MARKER_STATE_TEXT[state]}`,
        title: `${p.number} · ${stageTitle(p.stage)}`,
      },
      state === "mastered" ? MASTERY_SYMBOL : introNext ? "\u266A" : "★",
    );
    marker.addEventListener("click", () => select({ clef, stageId: p.stage.id }));
    return marker;
  });
  const passed = placed.filter((p) => track.stages[p.stage.id].stars >= advanceStars(p.stage)).length;
  const current = placed.find((p) => p.stage.id === track.currentStageId && markerState(p.stage.id, track.stages[p.stage.id], p.stage.id) === "current");
  let line = "";
  let tone = "";
  if (current) {
    const stageProgress = track.stages[current.stage.id];
    tone = "current";
    line =
      stageProgress.introOpen && !stageProgress.introDone
        ? `${current.number} · Intro next`
        : `${current.number} · ${TIER_LABELS[stageTiers(current.stage)[stageProgress.stars]]} next`;
  } else if (passed === placed.length) {
    line = `All ${placed.length} passed`;
  } else if (passed > 0) {
    line = `${passed} of ${placed.length} passed`;
  }
  return h(
    "div",
    { class: "chapter-side", "data-clef": clef, "data-tone": tone },
    h("span", { class: "chapter-side-clef" }, TRACK_LABELS[clef]),
    h("span", { class: "stage-markers" }, ...markers),
    line && h("span", { class: "chapter-side-line" }, line),
  );
}

/** The open stage under its chapter: its intro, then its tiers, or the choice to start there. */
function selectedDetail(ref: StageRef, progress: Progress, actions: TrackActions): HTMLElement {
  const placed = placedStage(ref.stageId)!;
  const stageProgress = progress[ref.clef].stages[ref.stageId];
  const intro = hasIntro(placed.stage) ? introLine(ref.stageId, stageProgress, actions) : null;
  const body =
    stageProgress.unlocked || stageProgress.introOpen
      ? stageDetail(ref.stageId, stageProgress, actions)
      : lockedDetail(ref.stageId, placed.number, actions);
  return h(
    "section",
    { class: "curriculum-detail", "data-clef": ref.clef, "aria-label": `${TRACK_LABELS[ref.clef]} ${placed.number}` },
    h(
      "header",
      { class: "curriculum-detail-head" },
      h("span", { class: "curriculum-detail-kicker" }, `${TRACK_LABELS[ref.clef]} · ${placed.number}`),
      h("h2", { class: "curriculum-detail-title" }, stageTitle(placed.stage)),
      stars(stageProgress.stars, maxStars(placed.stage), stageProgress.mastered),
    ),
    intro,
    body,
  );
}

/**
 * Both clefs' tracks on one trunk: a chapter per row, the treble's stages on its left and the
 * bass's on its right, one marker each. The selected stage opens under its chapter.
 */
export function renderCurriculum(root: HTMLElement, progress: Progress, selected: StageRef | null, actions: CurriculumActions): void {
  const select = (ref: StageRef) => actions(ref.clef).select(ref.stageId);
  const chapters = CHAPTERS.map((chapter, chapterIndex) => {
    const placed = PLACED_STAGES.filter((p) => p.chapterIndex === chapterIndex);
    const open = (clef: Clef) => placed.some((p) => progress[clef].stages[p.stage.id].unlocked || progress[clef].stages[p.stage.id].introOpen);
    const [treble, bass] = CLEF_TRACKS.map((clef) => chapterSide(clef, chapterIndex, progress, selected, select));
    const tone = [treble, bass].some((side) => side.dataset.tone === "current") ? "current" : CLEF_TRACKS.some(open) ? "open" : "locked";
    const row = h(
      "div",
      { class: "chapter-row" },
      treble,
      h(
        "div",
        { class: "chapter-trunk" },
        h("span", { class: "chapter-node", "data-tone": tone, "aria-hidden": "true" }, String(chapterIndex + 1)),
        h("h2", { class: "chapter-name" }, chapter.title),
      ),
      bass,
    );
    const inChapter = selected && placedStage(selected.stageId)?.chapterIndex === chapterIndex;
    return inChapter ? [row, selectedDetail(selected, progress, actions(selected.clef))] : [row];
  });
  root.replaceChildren(
    h(
      "div",
      { class: "curriculum-page" },
      h("h1", { class: "menu-heading" }, "Curriculum"),
      h("div", { class: "curriculum" }, ...chapters.flat()),
    ),
  );
  root.querySelector(".curriculum-detail")?.scrollIntoView({ block: "nearest" });
}

function listText(items: readonly string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0];
}

/** "The C major scale, quarter notes, half notes and whole notes": in the order the intro takes them. */
export function introTitle(stageId: string): string {
  const { stage } = placedStage(stageId)!;
  // Lower-case notation names after the first, but not "3/4 time" or "Cut time (2/2)"'s capitals mid-name.
  const notations = stage.introduces.map((n) => NOTATION_LABELS[n].replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase()));
  const keys = stageNewKeys(stage).map(keyFullName);
  const scales = keys.length > 0 ? [`the ${listText(keys)} scale${keys.length > 1 ? "s" : ""}`] : [];
  const title = listText([...scales, ...notations]);
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** The intro before a stage with new notation or keys; the stage opens once it's done, and it can be replayed. */
function introLine(stageId: string, progress: StageProgress, actions: TrackActions): HTMLElement {
  const button = h(
    "button",
    { class: progress.introOpen && !progress.introDone ? "btn-primary" : "btn-secondary", type: "button", disabled: !progress.introOpen },
    !progress.introOpen ? "Locked" : progress.introDone ? "Replay" : "Start",
  );
  button.addEventListener("click", () => actions.intro(stageId));
  return h(
    "div",
    { class: "intro-line" },
    h("span", { class: "intro-line-mark", "aria-hidden": "true" }, "\u266A"),
    h("span", { class: "intro-line-text" }, h("span", { class: "intro-line-label" }, "Intro"), introTitle(stageId)),
    button,
  );
}

const TIER_HINTS: Record<Tier, string> = {
  read: "Wait mode",
  play: "Rhythm mode",
  mix: "Half earlier stages",
  fluent: "Mix, faster",
};

/** A tier's hint; Fluent mixes like Mix, except on a stage without one. */
function tierHint(stage: Stage, tier: Tier): string {
  return tier === "fluent" && !stageTiers(stage).includes("mix") ? "Rhythm, faster" : TIER_HINTS[tier];
}

function stageDetail(stageId: string, progress: StageProgress, actions: TrackActions): HTMLElement {
  const { stage } = placedStage(stageId)!;
  const tiers = stageTiers(stage).map((tier, i) => {
    const tierProgress = progress.tiers[tier];
    const open = progress.tierOpen[tier];
    const earned = progress.stars > i;
    const tempo = tierTempo(stage, tier);
    const button = h(
      "button",
      { class: earned || !open ? "btn-secondary" : "btn-primary", type: "button", disabled: !open },
      // Once a tier has been played, its button picks up where that left off.
      open ? `${tierProgress.attempts > 0 ? "Continue" : "Start"} ${TIER_LABELS[tier]}` : "Locked",
    );
    button.addEventListener("click", () => actions.start(stageId, tier));
    return h(
      "div",
      { class: "tier-card", "data-open": open ? "true" : "false" },
      h("div", { class: "tier-card-head" }, stars(i + 1, i + 1), h("span", { class: "tier-name" }, TIER_LABELS[tier])),
      h("span", { class: "menu-muted" }, tempo ? `${tierHint(stage, tier)} · ${tempo} bpm` : tierHint(stage, tier)),
      h(
        "span",
        { class: "menu-muted" },
        earned
          ? "Earned"
          : `${recentHits(tierProgress.recent)}/${MISS_WINDOW} of the last ${MISS_WINDOW} · ${ADVANCE_TEXT}`,
      ),
      button,
    );
  });
  const { rounds } = progress.tiers.fluent;
  return h(
    "div",
    { class: "stage-detail" },
    h("div", { class: "chips" }, ...stageFacts(stage).map((fact) => h("span", { class: "chip" }, fact))),
    h("div", { class: "tier-grid" }, ...tiers),
    h(
      "div",
      { class: "mastery-row", "data-mastered": progress.mastered ? "true" : "false" },
      h("span", { class: progress.mastered ? "mastery-mark on" : "mastery-mark" }, MASTERY_SYMBOL),
      h(
        "span",
        { class: "menu-muted" },
        progress.mastered
          ? "Mastered"
          : progress.stars === maxStars(stage)
            ? `Master: ${MASTERY_TEXT} · ${rounds} of ${MASTERY_ROUNDS}`
            : `Master: after ${"★".repeat(maxStars(stage))}, ${MASTERY_TEXT}`,
      ),
      masteryPips(rounds),
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
  const tiers = stageTiers(placed.stage).map((tier, i) => {
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
      h("span", { class: "tier-tab-stars" }, `${"★".repeat(i + 1)} `),
      TIER_LABELS[tier],
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
      stars(model.progress.stars, maxStars(placed.stage), model.progress.mastered),
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
  const skip = h("button", { class: "btn-secondary", type: "button" }, model.replay ? "Continue on the track" : last ? "Skip to the stage" : "Skip intro");
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

export type ResultTone = "perfect" | "fault" | "info";

/** Shows a short message over the notation after each phrase. */
/** How a phrase went, written on the notation panel: one emoji, a headline, and what it means. */
export interface ResultMessage {
  emoji: string;
  title: string;
  detail?: string;
  tone: ResultTone;
}

export class PhraseResultBanner {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly root: HTMLElement) {}

  show({ emoji, title, detail, tone }: ResultMessage, ms = 2600): void {
    clearTimeout(this.timer);
    const headline = h("span", { class: "result-title" }, h("span", { class: "result-emoji", "aria-hidden": "true" }, emoji), title);
    this.root.replaceChildren(headline, ...(detail ? [h("span", { class: "result-detail" }, detail)] : []));
    this.root.dataset.tone = tone;
    // Shown afresh, so the entrance plays again even while the last message is up.
    this.root.hidden = true;
    void this.root.offsetWidth;
    this.root.hidden = false;
    this.timer = setTimeout(() => this.hide(), ms);
  }

  hide(): void {
    clearTimeout(this.timer);
    this.root.hidden = true;
  }
}

/** Where Advance leads from a stage: its successor's first tier still to earn, its intro, or the track. */
export type NextStep = { kind: "stage"; stageId: string; tier: Tier } | { kind: "intro"; stageId: string } | { kind: "track" };

export function nextStepAfter(progress: Progress, clef: Clef, stageId: string): NextStep {
  const next = PLACED_STAGES[placedStage(stageId)!.order + 1];
  if (!next) return { kind: "track" };
  const stage = progress[clef].stages[next.stage.id];
  if (stage.unlocked) {
    const tiers = stageTiers(next.stage);
    return { kind: "stage", stageId: next.stage.id, tier: tiers[Math.min(stage.stars, tiers.length - 1)] };
  }
  if (stage.introOpen && !stage.introDone) return { kind: "intro", stageId: next.stage.id };
  return { kind: "track" };
}

export type MilestoneChoice = "stay" | "advance" | "fluent";

/** The MIDI key that picks each choice: Stay on the left, Fluent (when offered) on the right. */
export const MILESTONE_KEYS: Record<MilestoneChoice, number> = { stay: 48, advance: 60, fluent: 72 };

export interface MilestoneModel {
  clef: Clef;
  stageId: string;
  milestone: Milestone;
  progress: Progress;
}

/** The choices a milestone offers, left to right. */
export function milestoneChoices(milestone: Milestone, stageId: string): MilestoneChoice[] {
  const advance = advanceStars(placedStage(stageId)!.stage);
  return milestone.kind === "star" && milestone.stars === advance ? ["stay", "advance", "fluent"] : ["stay", "advance"];
}

/** Replaces the staff after a star or a completed stage: stay on this tier, or move on. */
export function renderMilestone(root: HTMLElement, model: MilestoneModel, choose: (choice: MilestoneChoice) => void): void {
  const { clef, stageId, milestone, progress } = model;
  const { stage, number } = placedStage(stageId)!;
  const next = nextStepAfter(progress, clef, stageId);
  const nextNumber = next.kind === "track" ? undefined : placedStage(next.stageId)!.number;
  const goNext =
    next.kind === "intro" ? "Watch the intro" : next.kind === "stage" ? `Go to ${nextNumber}` : "Back to the track";
  const nextLine =
    next.kind === "intro"
      ? `Stage ${nextNumber} brings in ${lowerFirst(introTitle(next.stageId))}. Its short intro comes first.`
      : next.kind === "stage"
        ? `Next up: ${stageTitle(placedStage(next.stageId)!.stage)}.`
        : "That's the last stage in the track.";

  let headline: string;
  let line: string;
  let labels: Record<MilestoneChoice, string>;
  if (milestone.kind === "mastered") {
    headline = `Stage ${number} mastered.`;
    line = nextLine;
    labels = { stay: "Keep going", advance: goNext, fluent: "" };
  } else if (milestone.stars === 1) {
    headline = `Nice. You can read stage ${number}.`;
    line = `Next up is Play: the same music, in time with the metronome at ${stage.tempo} bpm.`;
    labels = { stay: "Keep reading", advance: "Start Play", fluent: "" };
  } else if (milestone.stars < advanceStars(stage)) {
    headline = `You can play stage ${number} in time.`;
    line = `Next up is Mix: half this stage, half earlier ones, at ${stage.tempo} bpm. It opens the next stage.`;
    labels = { stay: "Keep playing", advance: "Start Mix", fluent: "" };
  } else if (milestone.stars === advanceStars(stage)) {
    headline = next.kind === "stage" && milestone.openedStageId ? `Stage ${number} passed. Stage ${nextNumber} is open.` : `Stage ${number} passed.`;
    line = `${nextLine} Or push this one to Fluent, at ${stage.fluentTempo} bpm.`;
    labels = { stay: `Stay on ${number}`, advance: goNext, fluent: "Try Fluent" };
  } else {
    headline = `Fluent at ${stage.fluentTempo} bpm. That's every star.`;
    line = `Stay to master it: ${MASTERY_TEXT}. ${nextLine}`;
    labels = { stay: `Master ${number}`, advance: goNext, fluent: "" };
  }

  const mastered = milestone.kind === "mastered" ? true : milestone.stars === maxStars(stage) ? false : undefined;
  const earned = stars(milestone.stars, maxStars(stage), mastered);
  // What was just earned pops in: the crown when mastered, else the newest star.
  const fresh = milestone.kind === "mastered" ? earned.querySelector(".mastery-mark") : earned.querySelectorAll(".star.on")[milestone.stars - 1];
  fresh?.classList.add("fresh");
  root.replaceChildren(choiceCard(earned, headline, line, milestoneChoices(milestone, stageId), labels, choose));
}

/** Ends an intro before its stage starts: watch it again, or go on. Uses the milestone keys, C3 and C4. */
export function renderIntroDone(
  root: HTMLElement,
  model: { stageId: string; replay: boolean },
  choose: (choice: MilestoneChoice) => void,
): void {
  const { stage, number } = placedStage(model.stageId)!;
  const line = model.replay
    ? "Watch it again, or continue on the track."
    : `Next up is stage ${number}: ${stageTitle(stage)}. Read comes first, at your own pace.`;
  const labels = { stay: "Repeat intro", advance: model.replay ? "Continue on the track" : "Let's go", fluent: "" };
  root.replaceChildren(choiceCard(null, `That's the intro to ${number}.`, line, ["stay", "advance"], labels, choose));
}

/** A card that stands in for the staff: what happened, then a button per choice, each with its key. */
function choiceCard(
  top: Node | null,
  headline: string,
  line: string,
  choices: readonly MilestoneChoice[],
  labels: Record<MilestoneChoice, string>,
  choose: (choice: MilestoneChoice) => void,
): HTMLElement {
  return h(
    "div",
    { class: "milestone-card" },
    top,
    h("p", { class: "milestone-headline" }, headline),
    h("p", { class: "milestone-line" }, line),
    h(
      "div",
      { class: "milestone-actions", "data-count": String(choices.length) },
      ...choices.map((choice) => {
        const key = h("kbd", { class: "milestone-key" }, midiNoteName(MILESTONE_KEYS[choice]));
        const label = h("span", {}, labels[choice]);
        // Stay's key sits on its left, the others' on their right: towards where they lie on the piano.
        const button = h(
          "button",
          { type: "button", class: choice === "advance" ? "btn-primary" : "btn-secondary", "data-choice": choice },
          ...(choice === "stay" ? [key, label] : [label, key]),
        );
        button.addEventListener("click", () => choose(choice));
        return button;
      }),
    ),
  );
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
