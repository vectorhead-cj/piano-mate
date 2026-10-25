import type { NoteEvent } from "../music/types";

type Listener = (event: NoteEvent) => void;

export class NoteStream {
  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: NoteEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
