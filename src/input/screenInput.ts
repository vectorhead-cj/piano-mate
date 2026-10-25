import type { NoteStream } from "./noteStream";

/**
 * Turns pointer presses on keys (elements with data-midi) into note events.
 * Each finger is tracked by pointerId so chords work. Returns a detach function.
 */
export function attachScreenInput(keyboard: HTMLElement, stream: NoteStream): () => void {
  const heldPitchByPointer = new Map<number, number>();
  const listeners = new AbortController();
  const { signal } = listeners;

  keyboard.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const key = (event.target as Element).closest<HTMLElement>("[data-midi]");
    if (!key) return;
    event.preventDefault();

    const pitch = Number(key.dataset.midi);
    heldPitchByPointer.set(event.pointerId, pitch);
    stream.emit({ kind: "on", pitch, time: performance.now(), source: "screen" });
  }, { signal });

  // Listen on window: a finger can slide off the key before it lifts.
  const release = (event: PointerEvent) => {
    const pitch = heldPitchByPointer.get(event.pointerId);
    if (pitch === undefined) return;
    heldPitchByPointer.delete(event.pointerId);
    stream.emit({ kind: "off", pitch, time: performance.now(), source: "screen" });
  };
  window.addEventListener("pointerup", release, { signal });
  window.addEventListener("pointercancel", release, { signal });

  return () => listeners.abort();
}
