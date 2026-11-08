import type { KeyInfo } from "../music/keys";

const SIZE_PX = 24;
const GAP_PX = 2;
const ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3z"/>' +
  '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/></svg>';

/** What the speaker button does: hovering it previews a key's scale on the keyboard, clicking plays it. */
export interface KeyScaleHandlers {
  play(key: KeyInfo): void;
  /** The key to show on the keyboard while hovered, or null once the pointer leaves. */
  preview(key: KeyInfo | null): void;
  /** Lights this keyboard instead of the main one; null goes back to the main one. */
  useKeyboard?(keyboard: { visibleRange: { lowest: number; highest: number }; setScaleLit(midi: number, on: boolean): void } | null): void;
}

/** A speaker button above the first staff's key signature (or the empty place C and A minor leave). */
export class KeySpeaker {
  private readonly button = document.createElement("button");
  private key: KeyInfo | null = null;

  constructor(
    private readonly container: HTMLElement,
    handlers: KeyScaleHandlers,
  ) {
    this.button.type = "button";
    this.button.className = "key-speaker";
    this.button.setAttribute("aria-label", "Hear this key's scale");
    this.button.innerHTML = ICON;
    this.button.addEventListener("click", () => this.key && handlers.play(this.key));
    // Touch has no hover; it just taps to play.
    this.button.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse" && this.key) handlers.preview(this.key);
    });
    this.button.addEventListener("pointerleave", () => handlers.preview(null));
  }

  /** Puts the button over the first key signature drawn in the container; hides it if none is. */
  place(key: KeyInfo): void {
    this.key = key;
    this.container.append(this.button);
    const origin = this.container.getBoundingClientRect();
    const rect = (selector: string) => this.container.querySelector(selector)?.getBoundingClientRect();
    const staff = rect(".staffline");
    const signature = rect(".vf-keysignature");
    const clef = rect(".vf-clef");
    const time = rect(".vf-timesignature");
    const middle = signature
      ? (signature.left + signature.right) / 2
      : clef && time
        ? (clef.right + time.left) / 2
        : undefined;
    this.button.hidden = !staff || middle === undefined;
    if (!staff || middle === undefined) return;
    this.button.style.left = `${middle - origin.left - SIZE_PX / 2}px`;
    this.button.style.top = `${Math.max(0, staff.top - origin.top - SIZE_PX - GAP_PX)}px`;
  }
}
