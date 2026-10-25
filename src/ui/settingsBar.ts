import type { NamingConvention } from "../music/types";
import type { Settings } from "../practice/settings";

/** Wires the settings form in index.html to a Settings object. */
export function bindSettingsBar(
  form: HTMLFormElement,
  initial: Settings,
  onChange: (settings: Settings, changed: keyof Settings) => void,
): void {
  const checkbox = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const select = (name: string) => form.elements.namedItem(name) as HTMLSelectElement;

  checkbox("namesOnNotes").checked = initial.namesOnNotes;
  checkbox("namesOnKeys").checked = initial.namesOnKeys;
  checkbox("accidentals").checked = initial.accidentals;
  select("convention").value = initial.convention;
  select("bars").value = String(initial.bars);

  form.addEventListener("change", (event) => {
    const changed = (event.target as HTMLInputElement | HTMLSelectElement).name as keyof Settings;
    onChange(
      {
        namesOnNotes: checkbox("namesOnNotes").checked,
        namesOnKeys: checkbox("namesOnKeys").checked,
        accidentals: checkbox("accidentals").checked,
        convention: select("convention").value as NamingConvention,
        bars: Number(select("bars").value),
      },
      changed,
    );
  });
}
