import { midiNoteName } from "../music/pitch";
import { RETRY_PITCH, type PracticeController } from "../practice/practiceController";

const STORAGE_KEY = "piano-mate.retryKey";

/**
 * Wires the retry-key button in the prefs: it shows the current key, and clicking it
 * waits for the next key pressed on a MIDI keyboard (clicking again cancels).
 * onChange fires with the new key, including once for the stored key at start.
 */
export function bindRetryKey(
  button: HTMLButtonElement,
  practice: PracticeController,
  onChange: (pitch: number) => void,
): void {
  let stopListening: (() => void) | null = null;

  const show = () => {
    const listening = stopListening !== null;
    button.textContent = listening ? "Press a MIDI key…" : midiNoteName(practice.retryPitch);
    button.setAttribute("aria-pressed", String(listening));
    button.title = listening ? "Click to cancel" : "Click, then press the key to use";
  };

  const use = (pitch: number) => {
    practice.retryPitch = pitch;
    show();
    onChange(pitch);
  };

  button.addEventListener("click", () => {
    if (stopListening) {
      stopListening();
      stopListening = null;
      show();
      return;
    }
    stopListening = practice.captureMidiKey((pitch) => {
      stopListening = null;
      use(pitch);
      try {
        localStorage.setItem(STORAGE_KEY, String(pitch));
      } catch {
        // Storage can be unavailable (private mode, blocked site data); the key still applies.
      }
    });
    show();
  });

  use(readStoredKey());
}

function readStoredKey(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const pitch = Number(stored);
    if (stored !== null && Number.isInteger(pitch) && pitch >= 0 && pitch <= 127) return pitch;
  } catch {
    // Fall through to the default.
  }
  return RETRY_PITCH;
}
