import type { Note } from "./types";

/** Whether a note continues the one before it through a tie: held, not pressed again. */
export function isTieContinuation(notes: readonly Note[], index: number): boolean {
  return index > 0 && notes[index - 1].tie === true;
}

/** The first note at or after `index` that is pressed (notes.length when none is left). */
export function nextPressed(notes: readonly Note[], index: number): number {
  while (index < notes.length && isTieContinuation(notes, index)) index++;
  return index;
}

/** Indices of the notes held on from the pressed note at `index`. */
export function tiedOn(notes: readonly Note[], index: number): number[] {
  const held: number[] = [];
  for (let i = index + 1; i < notes.length && isTieContinuation(notes, i); i++) held.push(i);
  return held;
}

/** How many notes are pressed, counting a tied note once. */
export function pressedCount(notes: readonly Note[]): number {
  return notes.filter((_, i) => !isTieContinuation(notes, i)).length;
}
