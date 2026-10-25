import { isBlackKey, pitchClass, whiteKeyName } from "../music/pitch";
import type { NamingConvention } from "../music/types";

export type KeyFlash = "correct" | "wrong" | "hint";

const FLASH_MS: Record<KeyFlash, number> = { correct: 250, wrong: 400, hint: 900 };
const MIN_WHITE_KEY_PX = 44;
const MAX_OCTAVES = 2;

/**
 * Lowest C to highest B to draw: as many octaves (up to 2) as fit with
 * finger-sized keys, always covering the pitches the exercise can use.
 */
export function keyboardRangeFor(
  lowestPitch: number,
  highestPitch: number,
  availableWidth: number,
): { lowest: number; highest: number } {
  const octavesThatFit = Math.floor(availableWidth / (MIN_WHITE_KEY_PX * 7));
  const octaves = Math.min(MAX_OCTAVES, Math.max(1, octavesThatFit));
  const lowest = lowestPitch - pitchClass(lowestPitch);
  const highestNeeded = highestPitch + (11 - pitchClass(highestPitch));
  return { lowest, highest: Math.max(lowest + 12 * octaves - 1, highestNeeded) };
}

/** Draws the keys and shows state. Knows nothing about where input comes from. */
export class KeyboardView {
  private keys = new Map<number, HTMLElement>();
  private flashTimers = new Map<string, number>();
  private range = { lowest: 0, highest: -1 };
  private convention: NamingConvention = "english";

  constructor(private readonly root: HTMLElement) {}

  setRange(lowest: number, highest: number): void {
    if (lowest === this.range.lowest && highest === this.range.highest) return;
    this.range = { lowest, highest };
    this.root.replaceChildren();
    this.keys.clear();

    let whiteKeysSoFar = 0;
    for (let midi = lowest; midi <= highest; midi++) {
      const key = document.createElement("div");
      key.dataset.midi = String(midi);
      if (isBlackKey(midi)) {
        key.className = "key black";
        key.style.setProperty("--white-before", String(whiteKeysSoFar));
      } else {
        key.className = "key white";
        const label = document.createElement("span");
        label.className = "label";
        key.append(label);
        whiteKeysSoFar++;
      }
      this.root.append(key);
      this.keys.set(midi, key);
    }
    this.root.style.setProperty("--white-count", String(whiteKeysSoFar));
    this.updateLabelText();
  }

  setLabels(visible: boolean, convention: NamingConvention): void {
    this.root.classList.toggle("show-labels", visible);
    this.convention = convention;
    this.updateLabelText();
  }

  setPressed(midi: number, pressed: boolean): void {
    this.keys.get(midi)?.classList.toggle("pressed", pressed);
  }

  flash(midi: number, kind: KeyFlash): void {
    const key = this.keys.get(midi);
    if (!key) return;
    const timerId = `${midi}-${kind}`;
    clearTimeout(this.flashTimers.get(timerId));
    key.classList.add(`flash-${kind}`);
    this.flashTimers.set(
      timerId,
      window.setTimeout(() => key.classList.remove(`flash-${kind}`), FLASH_MS[kind]),
    );
  }

  private updateLabelText(): void {
    for (const [midi, key] of this.keys) {
      const label = key.querySelector(".label");
      if (label) label.textContent = whiteKeyName(midi, this.convention);
    }
  }
}
