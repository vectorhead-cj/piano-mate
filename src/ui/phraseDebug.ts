import { exerciseToMusicXml } from "../music/musicXml";
import type { Exercise } from "../music/types";

/** Checkbox + MusicXML dump panel for the current phrase. */
export function bindPhraseDebug(
  checkbox: HTMLInputElement,
  panel: HTMLElement,
  getExercise: () => Exercise,
): { refresh: () => void } {
  const output = panel.querySelector("[data-phrase-xml]") as HTMLElement | null;
  const copyButton = panel.querySelector("[data-copy-phrase]") as HTMLButtonElement | null;
  if (!output || !copyButton) {
    throw new Error("Phrase debug panel is missing output or copy control");
  }

  const syncVisibility = () => {
    const on = checkbox.checked;
    panel.hidden = !on;
    if (on) refresh();
  };

  const refresh = () => {
    if (!checkbox.checked) return;
    output.textContent = exerciseToMusicXml(getExercise());
  };

  checkbox.addEventListener("change", syncVisibility);
  copyButton.addEventListener("click", async () => {
    const text = output.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      copyButton.textContent = "Copied";
      window.setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1200);
    } catch {
      copyButton.textContent = "Copy failed";
      window.setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1200);
    }
  });

  syncVisibility();
  return { refresh };
}
