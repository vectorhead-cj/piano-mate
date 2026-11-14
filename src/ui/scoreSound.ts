export type ScoreSound = "tap" | "hover";

const STORAGE_KEY = "piano-mate.scoreSound";
const CHOICES: readonly ScoreSound[] = ["tap", "hover"];

/**
 * Wires the Tap/click / Hover radios that pick when the piece score sounds the notes under the pointer.
 * Returns a reader for the current choice. Touch has no hover, so a tap always plays whichever is picked.
 */
export function bindScoreSound(form: HTMLFormElement): () => ScoreSound {
  const radios = form.elements.namedItem("scoreSound") as RadioNodeList;
  let choice = readStoredChoice();
  radios.value = choice;

  form.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    if (target.name !== "scoreSound") return;
    choice = target.value as ScoreSound;
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Storage can be unavailable (private mode, blocked site data); the choice still applies.
    }
  });
  return () => choice;
}

function readStoredChoice(): ScoreSound {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (CHOICES as readonly string[]).includes(stored)) return stored as ScoreSound;
  } catch {
    // Fall through to the default.
  }
  return "tap";
}
