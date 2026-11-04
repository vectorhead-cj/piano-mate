/**
 * The answer being entered on the keyboard: the keys pressed so far, in the order of the bar's
 * notes. A key already in the answer is taken out again by pressing it, whichever place it holds;
 * the ones after it move up.
 */
export interface Entry {
  readonly pressed: readonly number[];
}

export const EMPTY_ENTRY: Entry = { pressed: [] };

export type EntryChange = "added" | "removed" | "full";

/** One more key press on the answer; `size` is how many notes the bar has. */
export function press(entry: Entry, pitch: number, size: number): { entry: Entry; change: EntryChange } {
  const at = entry.pressed.indexOf(pitch);
  if (at >= 0) return { entry: { pressed: entry.pressed.filter((p) => p !== pitch) }, change: "removed" };
  if (entry.pressed.length >= size) return { entry, change: "full" };
  return { entry: { pressed: [...entry.pressed, pitch] }, change: "added" };
}

/** The place (from 1) each pressed key holds in the answer, to number the keys with. */
export function placesByPitch(entry: Entry): Map<number, number> {
  return new Map(entry.pressed.map((pitch, i) => [pitch, i + 1]));
}
