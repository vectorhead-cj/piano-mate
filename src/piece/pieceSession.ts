import { acceptWindowMs, beatMs, timingGrade, type TimingGrade } from "../practice/timing";
import type { PlaySpan, Target } from "./targets";

/** The narrowest a note's window gets when the same key comes again soon after. */
const MIN_WINDOW_MS = 60;

export type TargetState = "pending" | "correct" | "late" | "wrong";

export type PiecePlay =
  | { kind: "hit"; index: number; timing: TimingGrade }
  | { kind: "wrong"; index: number }
  | { kind: "early"; index: number }
  | { kind: "ignored" };

export type FaultKind = "wrong" | "early" | "missed";

export interface PassResult {
  clean: boolean;
  total: number;
  hits: number;
  /** The first thing that went wrong, by when it was due. */
  fault?: { kind: FaultKind; slot: number };
}

/**
 * Timed grading of a span with chords and two hands, at a set tempo. Each key pressed is
 * matched to the nearest unplayed note at that pitch, inside its window: the app's usual
 * window, narrowed where the same key comes again sooner. As in rhythm mode, a wrong key,
 * a right key before its window, or a note left unplayed spoils the pass; a hit outside
 * the on-time window is late but counts.
 */
export class PieceSession {
  readonly targets: readonly Target[];
  readonly tempo: number;
  readonly countInMs: number;
  readonly lengthMs: number;
  private readonly others: readonly Target[];
  private readonly windows: number[];
  private readonly beat: number;
  /** The widest any window gets: searches by due time can stop past it. */
  private readonly accept: number;
  private readonly states: TargetState[];
  private readonly settled: boolean[];
  private readonly faults: (FaultKind | undefined)[];
  private startAt: number | null = null;
  /** Targets before this are all settled, so searches can start here. */
  private firstOpen = 0;

  constructor(span: PlaySpan, tempo: number, countInBeats: number) {
    this.targets = span.targets;
    this.others = span.others;
    this.tempo = tempo;
    this.beat = beatMs(tempo);
    this.countInMs = countInBeats * this.beat;
    this.lengthMs = span.length * this.beat;
    const accept = acceptWindowMs(tempo);
    this.accept = accept;
    this.windows = this.targets.map((target, i) => {
      let gap = Infinity;
      for (let j = i - 1; j >= 0; j--) {
        if (this.targets[j].pitch === target.pitch) {
          gap = target.due - this.targets[j].due;
          break;
        }
      }
      for (let j = i + 1; j < this.targets.length; j++) {
        if (this.targets[j].pitch === target.pitch) {
          gap = Math.min(gap, this.targets[j].due - target.due);
          break;
        }
      }
      return Math.max(MIN_WINDOW_MS, Math.min(accept, (gap * this.beat) / 2));
    });
    this.states = this.targets.map(() => "pending");
    this.settled = this.targets.map(() => false);
    this.faults = this.targets.map(() => undefined);
  }

  /** First note due at `now + countInMs`. */
  arm(now: number): void {
    this.startAt = now + this.countInMs;
  }

  /** Wall-clock time the first note is due; null until armed. */
  get start(): number | null {
    return this.startAt;
  }

  /** When the span's last bar ends. */
  get endAt(): number | null {
    return this.startAt === null ? null : this.startAt + this.lengthMs;
  }

  dueAt(index: number): number {
    return (this.startAt ?? 0) + this.targets[index].due * this.beat;
  }

  stateOf(index: number): TargetState {
    return this.states[index];
  }

  /** Every note has been played or has passed. */
  get done(): boolean {
    return this.firstOpen >= this.targets.length;
  }

  /** Quarter beats into the span at `now`; negative during the count-in. */
  beatAt(now: number): number {
    return this.startAt === null ? -Infinity : (now - this.startAt) / this.beat;
  }

  /** Notes whose window has closed unplayed since the last tick. */
  tick(now: number): number[] {
    if (this.startAt === null) return [];
    const missed: number[] = [];
    for (let i = this.firstOpen; i < this.targets.length; i++) {
      if (this.dueAt(i) - this.accept > now) break;
      if (!this.settled[i] && now > this.dueAt(i) + this.windows[i]) {
        this.settle(i, "wrong");
        this.faults[i] ??= "missed";
        missed.push(i);
      }
    }
    this.advanceOpen();
    return missed;
  }

  play(pitch: number, time: number): PiecePlay {
    if (this.startAt === null || this.done) return { kind: "ignored" };
    this.tick(time);

    let best = -1;
    for (let i = this.firstOpen; i < this.targets.length; i++) {
      if (this.dueAt(i) - this.accept > time) break;
      if (this.settled[i] || this.targets[i].pitch !== pitch) continue;
      if (Math.abs(time - this.dueAt(i)) > this.windows[i]) continue;
      if (best < 0 || Math.abs(time - this.dueAt(i)) < Math.abs(time - this.dueAt(best))) best = i;
    }
    if (best >= 0) {
      const timing = timingGrade(time - this.dueAt(best), this.tempo);
      // A key pressed wrong at this note earlier keeps its red.
      this.settle(best, this.states[best] === "wrong" ? "wrong" : timing === "on-time" ? "correct" : "late");
      this.advanceOpen();
      return { kind: "hit", index: best, timing };
    }

    // The other hand's keys, while it's played for you.
    if (this.others.some((o) => o.pitch === pitch && Math.abs(time - this.wallTime(o.due)) <= this.accept)) {
      return { kind: "ignored" };
    }

    // The right key a little before its window: too early. Before the count-in ends it's just noodling.
    for (let i = this.firstOpen; i < this.targets.length; i++) {
      if (this.dueAt(i) - this.accept > time + this.beat) break;
      const opens = this.dueAt(i) - this.windows[i];
      if (!this.settled[i] && this.targets[i].pitch === pitch && opens > time) {
        if (time < this.startAt - this.accept) return { kind: "ignored" };
        this.states[i] = "wrong";
        this.faults[i] ??= "early";
        return { kind: "early", index: i };
      }
    }
    if (time < this.startAt - this.accept) return { kind: "ignored" };

    // Any other key is wrong, marked on the note nearest in time that's still to come or just gone.
    let nearest = -1;
    for (let i = 0; i < this.targets.length; i++) {
      if (nearest < 0 || Math.abs(time - this.dueAt(i)) < Math.abs(time - this.dueAt(nearest))) nearest = i;
    }
    if (nearest < 0) return { kind: "ignored" };
    this.states[nearest] = "wrong";
    this.faults[nearest] ??= "wrong";
    return { kind: "wrong", index: nearest };
  }

  result(): PassResult {
    const hits = this.states.filter((s, i) => this.settled[i] && s !== "wrong").length;
    const first = this.faults.findIndex((f) => f !== undefined);
    return {
      clean: first < 0 && hits === this.targets.length,
      total: this.targets.length,
      hits,
      ...(first >= 0 && { fault: { kind: this.faults[first]!, slot: this.targets[first].slot } }),
    };
  }

  private wallTime(due: number): number {
    return (this.startAt ?? 0) + due * this.beat;
  }

  private settle(index: number, state: TargetState): void {
    this.settled[index] = true;
    this.states[index] = state;
  }

  private advanceOpen(): void {
    while (this.firstOpen < this.targets.length && this.settled[this.firstOpen]) this.firstOpen++;
  }
}
