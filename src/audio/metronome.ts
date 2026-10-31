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

  /** Clicks totalBeats quarter beats from wallStart, which must be a barline; each bar's first is accented. */
  start(tempo: number, totalBeats: number, wallStart: number = performance.now(), beatsPerBar = 4): void {
    this.stop();
    const ms = beatMs(tempo);
    for (let beat = 0; beat < totalBeats; beat++) {
      const at = wallStart + beat * ms;
      const handle = setTimeout(() => {
        this.sound.click(beat % beatsPerBar === 0);
      }, Math.max(0, at - performance.now()));
      this.pending.push(handle);
    }
  }

  stop(): void {
    for (const handle of this.pending) clearTimeout(handle);
    this.pending = [];
  }
}
