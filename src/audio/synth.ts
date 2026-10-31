const PEAK_GAIN = 0.3;
const DECAY_SECONDS = 1.5;
/** Held notes settle to this share of the peak, then release over RELEASE_SECONDS. */
const SUSTAIN_LEVEL = 0.45;
const SUSTAIN_SETTLE_SECONDS = 0.3;
const RELEASE_SECONDS = 0.12;
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

  /**
   * @param holdSeconds Sustain the note this long, then release it, instead of letting it
   *   decay like a pluck (used to play phrases back, where note lengths matter).
   */
  play(pitch: number, velocity = 0.8, holdSeconds?: number): void {
    const running = this.runningContext();
    if (running) {
      this.scheduleNote(running, pitch, velocity, holdSeconds);
      return;
    }
    // First unlock (or after suspension): wait for resume so the note isn't dropped.
    void this.ensureRunning().then((context) => {
      if (context) this.scheduleNote(context, pitch, velocity, holdSeconds);
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

  private scheduleNote(context: AudioContext, pitch: number, velocity: number, holdSeconds?: number): void {
    const now = context.currentTime;
    const peak = PEAK_GAIN * velocity;
    const end = holdSeconds === undefined ? now + DECAY_SECONDS : now + holdSeconds + RELEASE_SECONDS;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.01);
    if (holdSeconds === undefined) {
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
    } else {
      // Settle to a sustain level, hold, then release.
      const sustainAt = now + Math.min(SUSTAIN_SETTLE_SECONDS, holdSeconds);
      gain.gain.exponentialRampToValueAtTime(peak * SUSTAIN_LEVEL, sustainAt);
      gain.gain.setValueAtTime(peak * SUSTAIN_LEVEL, now + holdSeconds);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
    }
    gain.connect(context.destination);

    const oscillator = context.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.value = 440 * 2 ** ((pitch - 69) / 12);
    oscillator.connect(gain);
    oscillator.onended = () => gain.disconnect();
    oscillator.start(now);
    oscillator.stop(end + 0.1);
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
