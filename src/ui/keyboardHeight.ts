export type KeyboardHeight = "large" | "small";

const STORAGE_KEY = "piano-mate.keyboardHeight";
const CHOICES: readonly KeyboardHeight[] = ["large", "small"];

/**
 * Wires the Large / Small keyboard radios. Small sets data-keyboard-height on <html>, which
 * styles.css uses to shrink the on-screen keyboard and give the music the space.
 */
export function bindKeyboardHeight(form: HTMLFormElement): void {
  const radios = form.elements.namedItem("keyboardHeight") as RadioNodeList;
  const root = document.documentElement;

  const apply = (choice: KeyboardHeight) => {
    if (choice === "large") root.removeAttribute("data-keyboard-height");
    else root.setAttribute("data-keyboard-height", choice);
  };

  const initial = readStoredChoice();
  radios.value = initial;
  apply(initial);

  form.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    if (target.name !== "keyboardHeight") return;
    const choice = target.value as KeyboardHeight;
    apply(choice);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Storage can be unavailable (private mode, blocked site data); the choice still applies.
    }
  });
}

function readStoredChoice(): KeyboardHeight {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (CHOICES as readonly string[]).includes(stored)) return stored as KeyboardHeight;
  } catch {
    // Fall through to the default.
  }
  return "large";
}
