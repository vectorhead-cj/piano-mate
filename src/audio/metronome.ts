import { beatMs } from "../practice/timing";

export interface ClickSound {
  click(accent?: boolean): void;
}

/**
 * Wall-clock metronome. Each beat is scheduled from the same epoch so drift
 * does not accumulate the way a chained setTimeout would.
 */
export class Metronome {
  private pending: ReturnType<typeof setTimeout>[] = [];

  constructor(private readonly sound: ClickSound) {}

  start(tempo: number, totalBeats: number, wallStart: number = performance.now()): void {
    this.stop();
    const ms = beatMs(tempo);
    for (let beat = 0; beat < totalBeats; beat++) {
      const at = wallStart + beat * ms;
      const handle = setTimeout(() => {
        this.sound.click(beat % 4 === 0);
      }, Math.max(0, at - performance.now()));
      this.pending.push(handle);
    }
  }

  stop(): void {
    for (const handle of this.pending) clearTimeout(handle);
    this.pending = [];
  }
}
