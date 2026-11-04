import type { EventLog } from "./eventLog";
import { PROGRESS_EVENT_TYPES, type PracticeEvent } from "./events";
import { projectProgress, unlockAll, type Progress } from "./progress";

export type StoreStatus = "loading" | "ready" | "save-failed";

/**
 * Holds the events of PROGRESS_EVENT_TYPES in memory and the progress derived from them. Recording updates progress
 * at once; saving happens in the background. Events recorded before the log has loaded are
 * kept and written once it has.
 */
export class ProgressStore {
  private events: PracticeEvent[] = [];
  private pending: PracticeEvent[] = [];
  private log: EventLog | null = null;
  private listeners = new Set<() => void>();
  private unlockAll = false;
  progress: Progress = projectProgress([]);
  status: StoreStatus = "loading";

  constructor(log: Promise<EventLog>) {
    void log.then(async (opened) => {
      let loaded: PracticeEvent[] = [];
      try {
        loaded = await opened.load({ types: PROGRESS_EVENT_TYPES });
      } catch (error) {
        console.warn("Could not load practice history", error);
      }
      this.log = opened;
      this.events = [...loaded, ...this.pending].sort((a, b) => a.at - b.at);
      this.status = "ready";
      const pending = this.pending;
      this.pending = [];
      this.recompute();
      for (const event of pending) this.save(event);
    });
  }

  get storage(): EventLog["storage"] | null {
    return this.log?.storage ?? null;
  }

  get history(): readonly PracticeEvent[] {
    return this.events;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  record(event: PracticeEvent): void {
    this.events.push(event);
    if (this.log) this.save(event);
    else this.pending.push(event);
    this.recompute();
  }

  private save(event: PracticeEvent): void {
    this.log!.append(event).catch((error) => {
      console.warn("Could not save practice event", error);
      this.status = "save-failed";
      this.notify();
    });
  }

  /** Whether the debug switch that opens every stage is on. */
  get allUnlocked(): boolean {
    return this.unlockAll;
  }

  /** Debug: open every stage without changing what's recorded. */
  setUnlockAll(on: boolean): void {
    this.unlockAll = on;
    this.recompute();
  }

  private recompute(): void {
    const progress = projectProgress(this.events);
    this.progress = this.unlockAll ? unlockAll(progress) : progress;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
