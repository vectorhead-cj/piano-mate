/** How far ahead notes are handed to the audio clock, and how often the queue looks. */
const LOOKAHEAD_MS = 150;
const TICK_MS = 25;

export interface QueuedNote {
  pitch: number;
  velocity: number;
  holdSeconds: number;
  /** A performance.now() time. */
  at: number;
}

export interface ScheduledSound {
  play(pitch: number, velocity: number, holdSeconds: number, at: number): void;
  cancelPending(): void;
}

/**
 * Plays a run of notes on time: each is handed to the synth a little ahead and started on
 * the audio clock, as timers alone are too loose for quick ornaments. Stopping calls off
 * whatever hasn't started.
 */
export class SoundQueue {
  private notes: QueuedNote[] = [];
  private next = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly sound: ScheduledSound,
    private readonly now: () => number = () => performance.now(),
  ) {}

  play(notes: readonly QueuedNote[]): void {
    this.stop();
    this.notes = [...notes].sort((a, b) => a.at - b.at);
    this.next = 0;
    this.pump();
    if (this.next < this.notes.length) this.timer = setInterval(() => this.pump(), TICK_MS);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    if (this.notes.length > 0) this.sound.cancelPending();
    this.notes = [];
    this.next = 0;
  }

  private pump(): void {
    const horizon = this.now() + LOOKAHEAD_MS;
    while (this.next < this.notes.length && this.notes[this.next].at <= horizon) {
      const note = this.notes[this.next++];
      this.sound.play(note.pitch, note.velocity, note.holdSeconds, note.at);
    }
    if (this.next >= this.notes.length) clearInterval(this.timer);
  }
}
