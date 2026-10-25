import { ACCIDENTAL_FREQUENCY_LABELS, KEYS } from "../music/keys";
import { LEVELS } from "../music/levels";
import type { AccidentalFrequency } from "../music/types";
import type { Settings } from "../practice/settings";

/** Wires the settings form in index.html to a Settings object. */
export function bindSettingsBar(
  form: HTMLFormElement,
  initial: Settings,
  onChange: (settings: Settings, changed: keyof Settings) => void,
): void {
  const checkbox = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const select = (name: string) => form.elements.namedItem(name) as HTMLSelectElement;

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

  const rangeSelect = select("range");
  if (rangeSelect.options.length === 0) {
    for (const level of LEVELS) {
      const option = document.createElement("option");
      option.value = level.id;
      option.textContent = level.name;
      rangeSelect.append(option);
    }
  }

  checkbox("namesOnNotes").checked = initial.namesOnNotes;
  checkbox("namesOnKeys").checked = initial.namesOnKeys;
  keySelect.value = initial.key;
  frequencySelect.value = initial.accidentalFrequency;
  select("bars").value = String(initial.bars);
  rangeSelect.value = initial.range;

  form.addEventListener("change", (event) => {
    const changed = (event.target as HTMLInputElement | HTMLSelectElement).name as keyof Settings;
    onChange(
      {
        namesOnNotes: checkbox("namesOnNotes").checked,
        namesOnKeys: checkbox("namesOnKeys").checked,
        key: keySelect.value,
        accidentalFrequency: frequencySelect.value as AccidentalFrequency,
        bars: Number(select("bars").value),
        range: rangeSelect.value,
      },
      changed,
    );
  });
}
