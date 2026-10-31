import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import {
  BLOCKER_EXPLANATIONS,
  BLOCKER_LABELS,
  blockingNotes,
  corpusFacts,
  decodePhrases,
  melodicFailure,
  REPEAT_LIMIT,
  degreeLabel,
  RANGE_WINDOWS,
  RHYTHM_LABELS,
  type Blocker,
  type CollectionFile,
  type MelodicFailure,
  type PhraseFacts,
  type RhythmBucket,
} from "../facts";
import { phraseToMusicXml } from "./phraseXml";

type Mode = "major" | "minor" | "both";
type Rows = "narrowest" | "fits";

const RHYTHM_BUCKETS: readonly RhythmBucket[] = ["basic", "eighths", "busy"];
/** Columns by how many notes leave the key signature; the last one is "this many or more". */
const CHROMATIC_COLUMNS = [0, 1, 2, 3] as const;
const chromaticColumn = (facts: PhraseFacts) => Math.min(facts.chromatic, CHROMATIC_COLUMNS.length - 1);
const columnLabel = (column: number) => (column === CHROMATIC_COLUMNS.length - 1 ? `${column}+` : `${column}`);
/** Mode has its own filter, so it isn't shown as a blocker. */
const BLOCKERS = (Object.keys(BLOCKER_LABELS) as Blocker[]).filter((b) => b !== "minor");
const WIDER = "wider";
const SAMPLE_PAGE = 12;
/** Longer "phrases" are chorales cut where a fermata is missing, not phrases a curriculum would use. */
const MAX_BARS = 4;

type Selection =
  | { kind: "grid"; rhythm: RhythmBucket | null; row: string | null; chromatic: number | null }
  | { kind: "blocker"; blocker: Blocker }
  | { kind: "melodic"; failure: MelodicFailure };

const state = {
  clef: "treble",
  mode: "major" as Mode,
  rows: "narrowest" as Rows,
  dedupe: true,
  minNotes: 6,
  minBars: 2,
  minDistinct: 4,
  accepted: new Set<Blocker>(),
  collections: new Set<string>(),
  selection: null as Selection | null,
  shown: SAMPLE_PAGE,
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface Collection {
  id: string;
  label: string;
  files: number;
}

/** Every collection extract.py has written, largest first, and the facts of all their phrases. */
async function load(): Promise<{ collections: Collection[]; all: ReturnType<typeof corpusFacts> }> {
  const urls = import.meta.glob<string>("../data/collections/*.json", { query: "?url", import: "default", eager: true });
  const files = await Promise.all(Object.values(urls).map(async (url) => (await (await fetch(url)).json()) as CollectionFile));
  files.sort((a, b) => b.phrases.length - a.phrases.length);
  return {
    collections: files.map((f) => ({ id: f.collection, label: f.label, files: f.files })),
    // A fixed shuffle, so example lists mix collections rather than showing the largest first.
    all: corpusFacts(
      files
        .flatMap(decodePhrases)
        .map((phrase) => ({ phrase, order: hash(phrase.id) }))
        .sort((a, b) => a.order - b.order)
        .map(({ phrase }) => phrase),
    ),
  };
}

/** FNV-1a, for a stable order that doesn't follow the collections. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const { collections, all } = await load();
for (const c of collections) state.collections.add(c.id);
const collectionLabel = (id: string) => collections.find((c) => c.id === id)?.label ?? id;

function missing(facts: PhraseFacts): Blocker[] {
  return facts.blockers.filter((b) => b !== "minor" && !state.accepted.has(b));
}

interface FunnelStep {
  label: string;
  phrases: PhraseFacts[];
}

let cached: { key: string; steps: FunnelStep[] } | null = null;

/** The filters in order, each keeping what passes the one before; cached until a setting changes. */
function funnel(): FunnelStep[] {
  const key = JSON.stringify([state.clef, state.mode, state.dedupe, state.minNotes, state.minBars, state.minDistinct, [...state.accepted], [...state.collections]]);
  if (cached?.key !== key) cached = { key, steps: computeFunnel() };
  return cached.steps;
}

function computeFunnel(): FunnelStep[] {
  const steps: FunnelStep[] = [];
  let phrases = all.filter(({ facts }) => facts.phrase.clef === state.clef && state.collections.has(facts.phrase.collection));
  steps.push({ label: `All ${state.clef} phrases in the chosen collections`, phrases: phrases.map((p) => p.facts) });
  if (state.mode !== "both") {
    phrases = phrases.filter(({ facts }) => facts.mode === state.mode);
    steps.push({ label: `In a ${state.mode} key`, phrases: phrases.map((p) => p.facts) });
  }
  if (state.dedupe) {
    phrases = phrases.filter(({ duplicateOf }) => duplicateOf === null);
    steps.push({ label: "Not a repeat of an earlier melody", phrases: phrases.map((p) => p.facts) });
  }
  const enoughNotes = phrases.map((p) => p.facts).filter((f) => f.noteCount >= state.minNotes);
  steps.push({ label: `At least ${state.minNotes} notes`, phrases: enoughNotes });
  const long = enoughNotes.filter((f) => f.bars >= state.minBars && f.bars <= MAX_BARS);
  const span = state.minBars === MAX_BARS ? `${MAX_BARS}` : `${state.minBars}–${MAX_BARS}`;
  steps.push({ label: `${span} bars, not counting a pickup`, phrases: long });
  const melodic = long.filter((f) => melodicFailure(f, state.minDistinct) === null);
  steps.push({ label: `Melodic: ${state.minDistinct}+ different notes, repeats ≤ ${REPEAT_LIMIT * 100}%`, phrases: melodic });
  steps.push({ label: "Playable by the app", phrases: melodic.filter((f) => missing(f).length === 0) });
  return steps;
}

/** Phrases that pass every filter except the blockers. */
function candidates(): PhraseFacts[] {
  const steps = funnel();
  return steps[steps.length - 2].phrases;
}

/** Phrases the melodic check turns away, by reason. */
function unmelodic(failure: MelodicFailure): PhraseFacts[] {
  const steps = funnel();
  return steps[steps.length - 3].phrases.filter((f) => melodicFailure(f, state.minDistinct) === failure);
}

function playable(): PhraseFacts[] {
  const steps = funnel();
  return steps[steps.length - 1].phrases;
}

function rowIds(): string[] {
  return [...RANGE_WINDOWS.map((w) => w.id), WIDER];
}

function rowLabel(id: string): string {
  return RANGE_WINDOWS.find((w) => w.id === id)?.label ?? "Wider than all of these";
}

function inRow(facts: PhraseFacts, row: string): boolean {
  if (row === WIDER) return facts.narrowest === null;
  return state.rows === "narrowest" ? facts.narrowest === row : facts.windows.includes(row as never);
}

function selected(): PhraseFacts[] {
  const selection = state.selection;
  if (!selection) return [];
  if (selection.kind === "melodic") return unmelodic(selection.failure);
  if (selection.kind === "blocker") {
    // Phrases this blocker alone keeps out come first.
    const having = candidates().filter((f) => missing(f).includes(selection.blocker));
    return [...having.filter((f) => missing(f).length === 1), ...having.filter((f) => missing(f).length > 1)];
  }
  return playable().filter(
    (f) =>
      (selection.rhythm === null || f.rhythm === selection.rhythm) &&
      (selection.row === null || inRow(f, selection.row)) &&
      (selection.chromatic === null || chromaticColumn(f) === selection.chromatic),
  );
}

function renderIntro(): void {
  const unique = all.filter((p) => p.duplicateOf === null).length;
  $("intro").textContent =
    `Every single-voice line in the music21 corpus, ${collections.length} collections, cut into phrases: after fermatas where a line ` +
    `has them, at rests, and longer stretches split at barlines into windows of up to ${MAX_BARS} bars. ` +
    `${all.length.toLocaleString()} phrases, ${unique.toLocaleString()} once repeated melodies are skipped. ` +
    `Each line goes to the treble or bass clef by its register. Pickups and phrases ending mid-bar are fine.`;
}

function renderCollections(): void {
  const counts = new Map<string, number>();
  for (const { facts } of all) {
    if (facts.phrase.clef === state.clef) counts.set(facts.phrase.collection, (counts.get(facts.phrase.collection) ?? 0) + 1);
  }
  $("collections").innerHTML =
    collections
      .map(
        (c) => `<label class="chip${state.collections.has(c.id) ? " on" : ""}">
          <input type="checkbox" data-collection="${c.id}" ${state.collections.has(c.id) ? "checked" : ""}/>
          ${c.label} <span class="count">${(counts.get(c.id) ?? 0).toLocaleString()}</span></label>`,
      )
      .join("") + `<button class="link" data-all="on">All</button><button class="link" data-all="off">None</button>`;
}

function renderBreakdown(): void {
  const steps = funnel();
  const candidates = steps[steps.length - 2].phrases;
  const usable = steps[steps.length - 1].phrases;
  const rows = collections
    .filter((c) => state.collections.has(c.id))
    .map((c) => {
      const mine = usable.filter((f) => f.phrase.collection === c.id);
      return {
        c,
        candidates: candidates.filter((f) => f.phrase.collection === c.id).length,
        playable: mine.length,
        levels: RHYTHM_BUCKETS.map((r) => mine.filter((f) => f.rhythm === r).length),
      };
    })
    .sort((a, b) => b.playable - a.playable);
  $("breakdown").innerHTML = `<table><thead><tr><th>Collection</th><th>Before the last step</th><th>Playable</th>${RHYTHM_BUCKETS.map(
    (r) => `<th>${r}</th>`,
  ).join("")}</tr></thead><tbody>${rows
    .map(
      (r) =>
        `<tr><th>${r.c.label}</th><td>${r.candidates.toLocaleString()}</td><td class="total">${r.playable.toLocaleString()}</td>${r.levels
          .map((n) => `<td>${n.toLocaleString()}</td>`)
          .join("")}</tr>`,
    )
    .join("")}</tbody></table>`;
}

function renderFunnel(): void {
  const steps = funnel();
  const max = Math.max(1, steps[0].phrases.length);
  $("funnel").innerHTML = steps
    .map(
      ({ label, phrases }, i) => `
      <span class="step-label${i === steps.length - 1 ? " final" : ""}">${label}</span>
      <div class="funnel-bar"><span class="${i === steps.length - 1 ? "final" : "all"}" style="width:${(phrases.length / max) * 100}%"></span></div>
      <span class="num${i === steps.length - 1 ? " final" : ""}">${phrases.length.toLocaleString()}</span>`,
    )
    .join("");
  const usable = steps[steps.length - 1].phrases;
  $("levels").innerHTML =
    "Playable phrases by rhythm level: " +
    RHYTHM_BUCKETS.map((r) => `<b>${usable.filter((f) => f.rhythm === r).length.toLocaleString()}</b> ${r}`).join(" · ");
}

function scoreElement(facts: PhraseFacts, highlight: Blocker | null): HTMLElement {
  const score = document.createElement("div");
  score.className = "score";
  const osmd = new OpenSheetMusicDisplay(score, {
    backend: "svg",
    autoResize: false,
    drawTitle: false,
    drawPartNames: false,
    drawingParameters: "compacttight",
  });
  const notes = new Set(highlight ? blockingNotes(facts.phrase, highlight) : []);
  osmd
    .load(phraseToMusicXml(facts.phrase, notes))
    .then(() => {
      osmd.zoom = 0.8;
      osmd.render();
    })
    .catch((error: unknown) => {
      score.textContent = `Couldn't render: ${String(error)}`;
    });
  return score;
}

const CUT_LABELS: Record<string, string> = { fermata: "cut at a fermata", rest: "cut at a rest", end: "end of the line", window: "window of a longer stretch" };

function describe(facts: PhraseFacts): string {
  const p = facts.phrase;
  return [
    `${collectionLabel(p.collection)}: ${p.work}${p.title ? ` ${p.title}` : ""}, ${p.voice}, phrase ${p.index}`,
    `${facts.key.id} ${facts.mode}, ${p.time}${p.halved ? " (values halved)" : ""}`,
    CUT_LABELS[p.cut],
    `range ${degreeLabel(facts.low)}–${degreeLabel(facts.high)}`,
    `${facts.noteCount} notes, ${facts.bars} bar${facts.bars === 1 ? "" : "s"}${facts.pickup ? " + pickup" : ""}`,
    `${facts.chromatic} chromatic`,
    `${facts.rhythm} rhythm`,
  ].join(" · ");
}

/** "2/4: 5,210 · 6/8: 3,100 · …" for the phrases a time-signature blocker keeps out. */
function timeBreakdown(phrases: readonly PhraseFacts[]): string {
  const counts = new Map<string, number>();
  for (const f of phrases) {
    const time = f.phrase.times.length > 1 ? "changes time" : f.phrase.time;
    counts.set(time, (counts.get(time) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([time, count]) => `${time}: ${count.toLocaleString()}`)
    .join(" · ");
}

const MELODIC_LABELS: Record<MelodicFailure, string> = {
  distinct: "Too few different notes",
  repeats: "Too many repeated notes",
};

function renderMelodic(): void {
  const container = $("melodic");
  container.innerHTML = "";
  for (const failure of ["distinct", "repeats"] as const) {
    const rejected = unmelodic(failure);
    const card = document.createElement("article");
    card.className = "blocker";
    const rule =
      failure === "distinct"
        ? `Fewer than ${state.minDistinct} different notes (or, in a five-note or sixth range, fewer than the range holds).`
        : `More than ${REPEAT_LIMIT * 100}% of moves stay on the same note.`;
    card.innerHTML = `<header><h3>${MELODIC_LABELS[failure]}</h3></header><p>${rule}</p>
      <p class="effect"><b>${rejected.length.toLocaleString()}</b> phrases turned away.</p>`;
    if (rejected.length > 0) {
      const sample = document.createElement("div");
      sample.className = "sample";
      sample.innerHTML = `<div class="meta">${describe(rejected[0])}</div>`;
      sample.append(scoreElement(rejected[0], null));
      const more = document.createElement("button");
      more.className = "more";
      more.textContent = `See all ${rejected.length.toLocaleString()}`;
      more.addEventListener("click", () => select({ kind: "melodic", failure }));
      card.append(sample, more);
    }
    container.append(card);
  }
}

function renderBlockers(): void {
  const phrases = candidates();
  const cards = BLOCKERS.map((blocker) => {
    const having = phrases.filter((f) => f.blockers.includes(blocker));
    const only = having.filter((f) => {
      const m = missing(f);
      return m.length === 1 && m[0] === blocker;
    });
    return { blocker, having, only };
  }).filter((c) => c.having.length > 0);
  cards.sort((a, b) => b.only.length - a.only.length || b.having.length - a.having.length);
  const max = Math.max(1, ...cards.map((c) => c.having.length));

  const container = $("blockers");
  container.innerHTML = "";
  for (const { blocker, having, only } of cards) {
    const accepted = state.accepted.has(blocker);
    const card = document.createElement("article");
    card.className = `blocker${accepted ? " accepted" : ""}`;
    const effect = accepted
      ? `Counted as supported. ${having.length.toLocaleString()} phrases have it.`
      : `${having.length.toLocaleString()} phrases have it. <b>${only.length.toLocaleString()}</b> of them have nothing else wrong, so supporting it would add ${only.length.toLocaleString()}.`;
    const detail = blocker === "meter" ? `<p class="effect">${timeBreakdown(having)}</p>` : "";
    card.innerHTML = `
      <header>
        <h3>${BLOCKER_LABELS[blocker]}</h3>
        <label class="check"><input type="checkbox" data-blocker="${blocker}" ${accepted ? "checked" : ""}/> Count as supported</label>
      </header>
      <p>${BLOCKER_EXPLANATIONS[blocker]}</p>
      <div class="bar"><span class="also" style="width:${(having.length / max) * 100}%"></span><span class="only" style="width:${(only.length / max) * 100}%"></span></div>
      <p class="effect">${effect}</p>${detail}`;
    const example = only[0] ?? having[0];
    const others = missing(example).filter((b) => b !== blocker);
    const caption = document.createElement("p");
    caption.className = "caption";
    caption.textContent = accepted
      ? "Example:"
      : others.length === 0
        ? "Kept out only by this. Supporting it would make this phrase playable:"
        : `Example (also kept out by: ${others.map((b) => BLOCKER_LABELS[b].toLowerCase()).join(", ")}):`;
    const sample = document.createElement("div");
    sample.className = "sample";
    sample.innerHTML = `<div class="meta">${describe(example)}</div>`;
    sample.append(scoreElement(example, blocker));
    const more = document.createElement("button");
    more.className = "more";
    more.textContent = `See all ${having.length}`;
    more.addEventListener("click", () => select({ kind: "blocker", blocker }));
    card.append(caption, sample, more);
    container.append(card);
  }

  const absent = BLOCKERS.filter((b) => !cards.some((c) => c.blocker === b));
  $("absent").textContent = absent.length ? `Not found in these phrases: ${absent.map((b) => BLOCKER_LABELS[b].toLowerCase()).join(", ")}.` : "";
}

function cellStyle(count: number, max: number): string {
  if (count === 0) return "";
  const strength = Math.round(12 + 60 * (Math.log(count + 1) / Math.log(max + 1)));
  return `background: color-mix(in srgb, var(--accent) ${strength}%, transparent)`;
}

function renderGrids(): void {
  const phrases = playable();
  const groups: (RhythmBucket | null)[] = [...RHYTHM_BUCKETS, null];
  $("grids").innerHTML = groups
    .map((rhythm) => {
      const inGroup = phrases.filter((f) => rhythm === null || f.rhythm === rhythm);
      const rows = rowIds().filter((row) => row !== WIDER || inGroup.some((f) => f.narrowest === null));
      const counts = rows.map((row) => CHROMATIC_COLUMNS.map((column) => inGroup.filter((f) => inRow(f, row) && chromaticColumn(f) === column).length));
      const max = Math.max(1, ...counts.flat());
      const cell = (count: number, selection: Selection, total = false) => {
        const isSelected = state.selection && JSON.stringify(state.selection) === JSON.stringify(selection) ? " selected" : "";
        return count === 0
          ? `<td class="zero${total ? " total" : ""}">0</td>`
          : `<td class="cell${total ? " total" : ""}${isSelected}" style="${total ? "" : cellStyle(count, max)}" data-selection='${JSON.stringify(selection)}'>${count}</td>`;
      };
      const body = rows
        .map((row, i) => {
          const total = inGroup.filter((f) => inRow(f, row)).length;
          return `<tr><th>${rowLabel(row)}</th>${counts[i]
            .map((c, j) => cell(c, { kind: "grid", rhythm, row, chromatic: CHROMATIC_COLUMNS[j] }))
            .join("")}${cell(total, { kind: "grid", rhythm, row, chromatic: null }, true)}</tr>`;
        })
        .join("");
      const totals =
        state.rows === "narrowest"
          ? `<tr class="total"><th>All</th>${CHROMATIC_COLUMNS.map((column) =>
              cell(inGroup.filter((f) => chromaticColumn(f) === column).length, { kind: "grid", rhythm, row: null, chromatic: column }, true),
            ).join("")}${cell(inGroup.length, { kind: "grid", rhythm, row: null, chromatic: null }, true)}</tr>`
          : "";
      return `<div class="grid-card"><h3>${rhythm ? RHYTHM_LABELS[rhythm] : "All rhythm levels"}</h3>
        <table><thead><tr><th>Range</th>${CHROMATIC_COLUMNS.map((c) => `<th>${columnLabel(c)}</th>`).join("")}<th>all</th></tr></thead>
        <tbody>${body}${totals}</tbody></table></div>`;
    })
    .join("");
}

function selectionTitle(selection: Selection, count: number): string {
  if (selection.kind === "blocker") return `${BLOCKER_LABELS[selection.blocker]}: ${count} phrases, those kept out only by this first`;
  if (selection.kind === "melodic") return `${MELODIC_LABELS[selection.failure]}: ${count} phrases turned away as not melodic`;
  const parts = [
    selection.rhythm ? `${selection.rhythm} rhythm` : "any rhythm level",
    selection.row ? rowLabel(selection.row) : "any range",
    selection.chromatic === null ? "any accidentals" : `${columnLabel(selection.chromatic)} notes outside the key`,
  ];
  return `${parts.join(" · ")}: ${count} phrases`;
}

function renderSamples(): void {
  const section = $("samples-section");
  const selection = state.selection;
  if (!selection) {
    section.hidden = true;
    return;
  }
  const matching = selected();
  section.hidden = false;
  $("samples-title").textContent = selectionTitle(selection, matching.length);
  const container = $("samples");
  container.innerHTML = "";
  for (const facts of matching.slice(0, state.shown)) {
    const card = document.createElement("div");
    card.className = "sample";
    const blocked = missing(facts);
    card.innerHTML = `<div class="meta">${describe(facts)}${
      blocked.length ? `<br><span class="blocked">Kept out by: ${blocked.map((b) => BLOCKER_LABELS[b].toLowerCase()).join(", ")}</span>` : ""
    }</div>`;
    card.append(scoreElement(facts, selection.kind === "blocker" ? selection.blocker : null));
    container.append(card);
  }
  $("more").hidden = matching.length <= state.shown;
}

function select(selection: Selection): void {
  state.selection = selection;
  state.shown = SAMPLE_PAGE;
  renderGrids();
  renderSamples();
  $("samples-section").scrollIntoView({ behavior: "smooth" });
}

function render(): void {
  for (const [id, value] of [
    ["clef", state.clef],
    ["mode", state.mode],
    ["rows", state.rows],
    ["minBars", String(state.minBars)],
    ["minDistinct", String(state.minDistinct)],
  ]) {
    for (const button of $(id).querySelectorAll("button")) button.classList.toggle("on", button.dataset.value === value);
  }
  renderIntro();
  renderCollections();
  renderFunnel();
  renderBreakdown();
  renderMelodic();
  renderBlockers();
  renderGrids();
  renderSamples();
}

for (const id of ["clef", "mode", "rows", "minBars", "minDistinct"] as const) {
  $(id).addEventListener("click", (event) => {
    const value = (event.target as HTMLElement).closest("button")?.dataset.value;
    if (!value) return;
    (state as Record<string, unknown>)[id] = id === "minBars" || id === "minDistinct" ? Number(value) : value;
    state.shown = SAMPLE_PAGE;
    render();
  });
}

$<HTMLInputElement>("dedupe").addEventListener("change", (event) => {
  state.dedupe = (event.target as HTMLInputElement).checked;
  render();
});

$<HTMLInputElement>("min-notes").addEventListener("change", (event) => {
  state.minNotes = Math.max(1, Number((event.target as HTMLInputElement).value) || 1);
  render();
});

$("collections").addEventListener("change", (event) => {
  const id = (event.target as HTMLInputElement).dataset.collection;
  if (!id) return;
  if ((event.target as HTMLInputElement).checked) state.collections.add(id);
  else state.collections.delete(id);
  render();
});

$("collections").addEventListener("click", (event) => {
  const which = (event.target as HTMLElement).closest<HTMLElement>("[data-all]")?.dataset.all;
  if (!which) return;
  state.collections = new Set(which === "on" ? collections.map((c) => c.id) : []);
  render();
});

$("blockers").addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  const blocker = input.dataset.blocker as Blocker | undefined;
  if (!blocker) return;
  if (input.checked) state.accepted.add(blocker);
  else state.accepted.delete(blocker);
  render();
});

$("grids").addEventListener("click", (event) => {
  const cell = (event.target as HTMLElement).closest<HTMLElement>("td.cell");
  if (cell?.dataset.selection) select(JSON.parse(cell.dataset.selection) as Selection);
});

$("more").addEventListener("click", () => {
  state.shown += SAMPLE_PAGE;
  renderSamples();
});

render();
