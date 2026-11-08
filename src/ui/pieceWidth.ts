const STORAGE_KEY = "piano-mate.pieceWide";

/**
 * Whether piece practice spans the window (up to a cap) instead of the menu's width. Kept on <html> as
 * data-piece-wide, which styles.css reads for both the stage and the header buttons above it.
 */
export function pieceWide(): boolean {
  return document.documentElement.hasAttribute("data-piece-wide");
}

export function setPieceWide(wide: boolean): void {
  const root = document.documentElement;
  if (wide) root.setAttribute("data-piece-wide", "");
  else root.removeAttribute("data-piece-wide");
  try {
    localStorage.setItem(STORAGE_KEY, wide ? "1" : "0");
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the choice still applies.
  }
}

/** Applies the stored choice at start-up. */
export function restorePieceWide(): void {
  try {
    if (localStorage.getItem(STORAGE_KEY) === "1") document.documentElement.setAttribute("data-piece-wide", "");
  } catch {
    // Fall through to the default.
  }
}
