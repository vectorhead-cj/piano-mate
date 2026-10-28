const PEAK_GAIN = 0.3;
const DECAY_SECONDS = 1.5;
const CLICK_GAIN = 0.22;
const CLICK_SECONDS = 0.04;

/** A short plucked tone. Placeholder until we swap in piano samples. */
export class Synth {
  private context: AudioContext | null = null;
  /** In-flight resume so concurrent play/click/unlock share one unlock attempt. */
  private unlocking: Promise<AudioContext | null> | null = null;

  /** Call from a user gesture. Browsers only allow AudioContext to leave "suspended" then. */
  unlock(): void {
    void this.ensureRunning();
  }

  play(pitch: number, velocity = 0.8): void {
    const running = this.runningContext();
    if (running) {
      this.scheduleNote(running, pitch, velocity);
      return;
    }
    // First unlock (or after suspension): wait for resume so the note isn't dropped.
    void this.ensureRunning().then((context) => {
      if (context) this.scheduleNote(context, pitch, velocity);
    });
  }

  /** Short metronome blip. Accent beats use a slightly higher pitch. */
  click(accent = false): void {
    const running = this.runningContext();
    if (running) {
      this.scheduleClick(running, accent);
      return;
    }
    void this.ensureRunning().then((context) => {
      if (context) this.scheduleClick(context, accent);
    });
  }

  private runningContext(): AudioContext | null {
    return this.context?.state === "running" ? this.context : null;
  }

  private ensureRunning(): Promise<AudioContext | null> {
    const running = this.runningContext();
    if (running) return Promise.resolve(running);
    this.unlocking ??= this.resumeContext().finally(() => {
      this.unlocking = null;
    });
    return this.unlocking;
  }

  private async resumeContext(): Promise<AudioContext | null> {
    this.context ??= new AudioContext({ latencyHint: "interactive" });
    // resume() must be invoked synchronously inside a user-gesture stack; awaiting after is fine.
    if (this.context.state !== "running") {
      try {
        await this.context.resume();
      } catch {
        return null;
      }
    }
    return this.context.state === "running" ? this.context : null;
  }

  private scheduleNote(context: AudioContext, pitch: number, velocity: number): void {
    const now = context.currentTime;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(PEAK_GAIN * velocity, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + DECAY_SECONDS);
    gain.connect(context.destination);

    const oscillator = context.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.value = 440 * 2 ** ((pitch - 69) / 12);
    oscillator.connect(gain);
    oscillator.onended = () => gain.disconnect();
    oscillator.start(now);
    oscillator.stop(now + DECAY_SECONDS + 0.1);
  }

  private scheduleClick(context: AudioContext, accent: boolean): void {
    const at = context.currentTime;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(CLICK_GAIN * (accent ? 1 : 0.7), at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + CLICK_SECONDS);
    gain.connect(context.destination);

    const oscillator = context.createOscillator();
    oscillator.type = "square";
    oscillator.frequency.value = accent ? 1200 : 900;
    oscillator.connect(gain);
    oscillator.onended = () => gain.disconnect();
    oscillator.start(at);
    oscillator.stop(at + CLICK_SECONDS + 0.02);
  }
}
