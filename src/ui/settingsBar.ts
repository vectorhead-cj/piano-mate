import { ACCIDENTAL_FREQUENCY_LABELS, KEYS } from "../music/keys";
import { CLEF_LABELS, levelById, levelsForClef } from "../music/levels";
import { GENERATED_TIMES, RHYTHM_PROFILES, type GeneratedTime } from "../music/rhythms";
import type { AccidentalFrequency, Clef, RhythmFlavor } from "../music/types";
import {
  TEMPO_OPTIONS,
  type PhraseSource,
  type PracticeMode,
  type Settings,
} from "../practice/settings";

/** Wires the settings form in index.html to a Settings object. */
export function bindSettingsBar(
  form: HTMLFormElement,
  initial: Settings,
  onChange: (settings: Settings, changed: keyof Settings) => void,
): void {
  const checkbox = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const select = (name: string) => form.elements.namedItem(name) as HTMLSelectElement;

  // Mode is a segmented radio group in index.html; its labels come from the markup.
  const modeRadios = form.elements.namedItem("mode") as RadioNodeList;

  const tempoSelect = select("tempo");
  if (tempoSelect.options.length === 0) {
    for (const bpm of TEMPO_OPTIONS) {
      const option = document.createElement("option");
      option.value = String(bpm);
      option.textContent = `${bpm}`;
      tempoSelect.append(option);
    }
  }

  const keySelect = select("key");
  if (keySelect.options.length === 0) {
    for (const key of KEYS) {
      const option = document.createElement("option");
      option.value = key.id;
      option.textContent = key.label;
      keySelect.append(option);
    }
  }

  const frequencySelect = select("accidentalFrequency");
  if (frequencySelect.options.length === 0) {
    for (const [value, label] of Object.entries(ACCIDENTAL_FREQUENCY_LABELS)) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      frequencySelect.append(option);
    }
  }

  const rhythmSelect = select("rhythm");
  if (rhythmSelect.options.length === 0) {
    for (const profile of RHYTHM_PROFILES) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.label;
      rhythmSelect.append(option);
    }
  }

  const timeSelect = select("time");
  if (timeSelect.options.length === 0) {
    for (const time of GENERATED_TIMES) {
      const option = document.createElement("option");
      option.value = time;
      option.textContent = time;
      timeSelect.append(option);
    }
  }

  const clefSelect = select("clef");
  if (clefSelect.options.length === 0) {
    for (const [value, label] of Object.entries(CLEF_LABELS)) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      clefSelect.append(option);
    }
  }

  // Range options follow the clef; switching clef keeps the same position in the list.
  const rangeSelect = select("range");
  const fillRanges = (clef: Clef) => {
    const index = Math.max(rangeSelect.selectedIndex, 0);
    const levels = levelsForClef(clef);
    rangeSelect.replaceChildren(
      ...levels.map((level) => {
        const option = document.createElement("option");
        option.value = level.id;
        option.textContent = level.name;
        return option;
      }),
    );
    rangeSelect.selectedIndex = Math.min(index, levels.length - 1);
  };

  const syncTempoEnabled = (mode: PracticeMode) => {
    tempoSelect.disabled = mode !== "rhythm";
    const wrap = form.querySelector("#tempo-setting");
    wrap?.classList.toggle("field-disabled", mode !== "rhythm");
  };

  const readSettings = (): Settings => ({
    namesOnNotes: checkbox("namesOnNotes").checked,
    mode: modeRadios.value as PracticeMode,
    tempo: Number(tempoSelect.value),
    key: keySelect.value,
    accidentalFrequency: frequencySelect.value as AccidentalFrequency,
    rhythm: rhythmSelect.value as RhythmFlavor,
    time: timeSelect.value as GeneratedTime,
    source: select("source").value as PhraseSource,
    bars: Number(select("bars").value),
    clef: clefSelect.value as Clef,
    range: rangeSelect.value,
  });

  checkbox("namesOnNotes").checked = initial.namesOnNotes;
  modeRadios.value = initial.mode;
  tempoSelect.value = String(initial.tempo);
  keySelect.value = initial.key;
  frequencySelect.value = initial.accidentalFrequency;
  rhythmSelect.value = initial.rhythm;
  timeSelect.value = initial.time;
  select("source").value = initial.source;
  select("bars").value = String(initial.bars);
  clefSelect.value = levelById(initial.range).clef;
  fillRanges(clefSelect.value as Clef);
  rangeSelect.value = initial.range;
  syncTempoEnabled(initial.mode);

  form.addEventListener("change", (event) => {
    const name = (event.target as HTMLInputElement | HTMLSelectElement).name;
    // Ignore non-settings controls that share this form (e.g. debug toggles).
    if (!(name in initial)) return;
    const changed = name as keyof Settings;
    if (changed === "clef") fillRanges(clefSelect.value as Clef);
    const settings = readSettings();
    if (changed === "mode") syncTempoEnabled(settings.mode);
    onChange(settings, changed);
  });
}
