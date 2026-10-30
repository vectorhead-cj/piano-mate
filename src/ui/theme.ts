export type ThemeChoice = "auto" | "light" | "dark";

const STORAGE_KEY = "piano-mate.theme";
const CHOICES: readonly ThemeChoice[] = ["auto", "light", "dark"];

/**
 * Wires the Auto / Light / Dark radios. An explicit choice sets data-app-theme on <html>;
 * Auto leaves it off so styles.css follows the host's data-theme (the Claude artifact viewer
 * sets it) and then prefers-color-scheme. onChange fires whenever the effective theme may differ.
 */
export function bindTheme(form: HTMLFormElement, onChange: () => void): void {
  const radios = form.elements.namedItem("theme") as RadioNodeList;
  const root = document.documentElement;

  const apply = (choice: ThemeChoice) => {
    if (choice === "auto") root.removeAttribute("data-app-theme");
    else root.setAttribute("data-app-theme", choice);
  };

  const initial = readStoredChoice();
  radios.value = initial;
  apply(initial);

  form.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    if (target.name !== "theme") return;
    const choice = target.value as ThemeChoice;
    apply(choice);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Storage can be unavailable (private mode, blocked site data); the choice still applies.
    }
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onChange);
  new MutationObserver(onChange).observe(root, {
    attributes: true,
    attributeFilter: ["data-theme", "data-app-theme"],
  });
  // The stored choice was applied before the observers existed.
  onChange();
}

/** Opens and closes the display-settings popover from its toggle button. */
export function bindPrefsPopover(toggle: HTMLButtonElement, panel: HTMLElement): void {
  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
  document.addEventListener("pointerdown", (event) => {
    const target = event.target as Node;
    if (!panel.hidden && !panel.contains(target) && !toggle.contains(target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });
}

function readStoredChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (CHOICES as readonly string[]).includes(stored)) return stored as ThemeChoice;
  } catch {
    // Fall through to the default.
  }
  return "auto";
}
