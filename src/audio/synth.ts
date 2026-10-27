const PEAK_GAIN = 0.3;
const DECAY_SECONDS = 1.5;
const CLICK_GAIN = 0.22;
const CLICK_SECONDS = 0.04;

/** A short plucked tone. Placeholder until we swap in piano samples. */
export class Synth {
  private context: AudioContext | null = null;

  /** iOS only lets audio start from inside a user gesture, so call this from one. */
  unlock(): void {
    this.context ??= new AudioContext();
    if (this.context.state !== "running") void this.context.resume();
  }

  play(pitch: number, velocity = 0.8): void {
    this.unlock();
    const context = this.context!;
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

  /** Short metronome blip. Accent beats use a slightly higher pitch. */
  click(accent = false): void {
    this.unlock();
    const context = this.context!;
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
