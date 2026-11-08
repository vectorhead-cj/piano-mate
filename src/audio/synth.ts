import { KeyboardSink, type SoundOutput } from "./keyboardSink";

const PEAK_GAIN = 0.3;
const DECAY_SECONDS = 1.5;
/** Held notes settle to this share of the peak, then release over RELEASE_SECONDS. */
const SUSTAIN_LEVEL = 0.45;
const SUSTAIN_SETTLE_SECONDS = 0.3;
const RELEASE_SECONDS = 0.12;
/** Short held notes release faster, so quick ornament notes stay clear of each other. */
const MIN_RELEASE_SECONDS = 0.03;
const CLICK_GAIN = 0.22;
const CLICK_SECONDS = 0.04;
const BELL_CLICK_SECONDS = 0.07;
const BELL_CLICK_GAIN = 1.2;

/** Salamander Grand Piano samples (public/piano), one every minor third: C, D#, F#, A. */
const SAMPLE_NOTES: [string, number][] = [["C", 0], ["Ds", 3], ["Fs", 6], ["A", 9]];
const SAMPLE_GAIN = 0.7;
/** Unheld notes ring out naturally, faded after this long. */
const SAMPLE_RING_SECONDS = 6;

function samplePitches(): { name: string; pitch: number }[] {
  const out: { name: string; pitch: number }[] = [];
  for (let octave = 0; octave <= 8; octave++) {
    for (const [name, semitone] of SAMPLE_NOTES) {
      const pitch = 12 * (octave + 1) + semitone;
      if (pitch < 21 || pitch > 108 || (octave === 8 && name !== "C")) continue;
      out.push({ name: `${name}${octave}`, pitch });
    }
  }
  return out;
}

/** Piano sound: sampled grand piano once loaded, a plucked triangle tone until then (or if loading fails). */
export class Synth {
  /** Where notes go; the keyboard sink only sounds when a MIDI output is connected. */
  output: SoundOutput = "computer";
  keyboard: KeyboardSink | null = null;
  private context: AudioContext | null = null;
  /** In-flight resume so concurrent play/click/unlock share one unlock attempt. */
  private unlocking: Promise<AudioContext | null> | null = null;
  /** Notes scheduled to start later, so they can be called off. */
  private pending: { oscillator: AudioScheduledSourceNode; gain: GainNode; start: number }[] = [];
  private samples: { pitch: number; buffer: AudioBuffer }[] = [];
  private samplesLoading = false;

  /** Call from a user gesture. Browsers only allow AudioContext to leave "suspended" then. */
  unlock(): void {
    void this.ensureRunning();
  }

  /**
   * @param holdSeconds Sustain the note this long, then release it, instead of letting it
   *   decay like a pluck (used to play phrases back, where note lengths matter).
   * @param at When to start, as a performance.now() time; now if absent or past. Played on
   *   the audio clock, so notes scheduled a little ahead keep exact time.
   */
  play(pitch: number, velocity = 0.8, holdSeconds?: number, at?: number): void {
    if (this.output !== "computer") this.keyboard?.play(pitch, velocity, holdSeconds, at);
    // Keyboard-only still falls back to the speakers when no keyboard is connected.
    if (this.output === "keyboard" && this.keyboard?.available) return;
    const running = this.runningContext();
    if (running) {
      this.scheduleNote(running, pitch, velocity, holdSeconds, at);
      return;
    }
    // First unlock (or after suspension): wait for resume so the note isn't dropped.
    void this.ensureRunning().then((context) => {
      if (context) this.scheduleNote(context, pitch, velocity, holdSeconds, at);
    });
  }

  /** Calls off notes scheduled ahead that haven't started yet; ones sounding ring on. */
  cancelPending(): void {
    this.keyboard?.cancelPending();
    const now = this.context?.currentTime ?? 0;
    for (const { oscillator, gain, start } of this.pending) {
      if (start <= now) continue;
      oscillator.onended = null;
      oscillator.stop();
      gain.disconnect();
    }
    this.pending = [];
  }

  /** Short metronome blip. Accent beats use a slightly higher pitch; bell is the softer voice for bars that aren't 4/4. */
  click(accent = false, bell = false): void {
    const running = this.runningContext();
    if (running) {
      this.scheduleClick(running, accent, bell);
      return;
    }
    void this.ensureRunning().then((context) => {
      if (context) this.scheduleClick(context, accent, bell);
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
    if (this.context.state !== "running") return null;
    void this.loadSamples(this.context);
    return this.context;
  }

  /** Fetches and decodes the piano samples once; notes use the synth tone until they arrive. */
  private async loadSamples(context: AudioContext): Promise<void> {
    if (this.samplesLoading) return;
    this.samplesLoading = true;
    const base = `${import.meta.env.BASE_URL}piano/`;
    const loaded = await Promise.all(
      samplePitches().map(async ({ name, pitch }) => {
        try {
          const response = await fetch(`${base}${name}.mp3`);
          if (!response.ok) return null;
          return { pitch, buffer: await context.decodeAudioData(await response.arrayBuffer()) };
        } catch {
          return null;
        }
      }),
    );
    this.samples = loaded.filter((s): s is { pitch: number; buffer: AudioBuffer } => s !== null);
  }

  private nearestSample(pitch: number): { pitch: number; buffer: AudioBuffer } | null {
    let best: { pitch: number; buffer: AudioBuffer } | null = null;
    for (const sample of this.samples) {
      if (!best || Math.abs(sample.pitch - pitch) < Math.abs(best.pitch - pitch)) best = sample;
    }
    return best;
  }

  private scheduleSample(context: AudioContext, sample: { pitch: number; buffer: AudioBuffer }, pitch: number, velocity: number, holdSeconds: number | undefined, now: number): void {
    const source = context.createBufferSource();
    source.buffer = sample.buffer;
    source.playbackRate.value = 2 ** ((pitch - sample.pitch) / 12);
    const natural = sample.buffer.duration / source.playbackRate.value;
    const gain = context.createGain();
    const peak = SAMPLE_GAIN * velocity;
    gain.gain.setValueAtTime(peak, now);
    let end: number;
    if (holdSeconds === undefined) {
      end = now + Math.min(natural, SAMPLE_RING_SECONDS);
      gain.gain.setValueAtTime(peak, Math.max(now, end - 0.5));
      gain.gain.linearRampToValueAtTime(0, end);
    } else {
      // The damper falls when the key is released.
      const release = Math.min(RELEASE_SECONDS, Math.max(MIN_RELEASE_SECONDS, holdSeconds / 2));
      end = now + Math.min(holdSeconds + release, natural);
      const releaseAt = Math.max(now, end - release);
      gain.gain.setValueAtTime(peak, releaseAt);
      gain.gain.linearRampToValueAtTime(0, end);
    }
    source.connect(gain);
    gain.connect(context.destination);
    const voice = { oscillator: source, gain, start: now };
    if (now > context.currentTime) this.pending.push(voice);
    source.onended = () => {
      gain.disconnect();
      this.pending = this.pending.filter((v) => v !== voice);
    };
    source.start(now);
    source.stop(end + 0.05);
  }

  private scheduleNote(context: AudioContext, pitch: number, velocity: number, holdSeconds?: number, at?: number): void {
    const now = Math.max(context.currentTime, at === undefined ? 0 : context.currentTime + (at - performance.now()) / 1000);
    const sample = this.nearestSample(pitch);
    if (sample) {
      this.scheduleSample(context, sample, pitch, velocity, holdSeconds, now);
      return;
    }
    const peak = PEAK_GAIN * velocity;
    const release = holdSeconds === undefined ? 0 : Math.min(RELEASE_SECONDS, Math.max(MIN_RELEASE_SECONDS, holdSeconds / 2));
    const end = holdSeconds === undefined ? now + DECAY_SECONDS : now + holdSeconds + release;

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
    const voice = { oscillator, gain, start: now };
    if (now > context.currentTime) this.pending.push(voice);
    oscillator.onended = () => {
      gain.disconnect();
      this.pending = this.pending.filter((v) => v !== voice);
    };
    oscillator.start(now);
    oscillator.stop(end + 0.1);
  }

  private scheduleClick(context: AudioContext, accent: boolean, bell: boolean): void {
    const at = context.currentTime;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    const seconds = bell ? BELL_CLICK_SECONDS : CLICK_SECONDS;
    gain.gain.exponentialRampToValueAtTime(CLICK_GAIN * (bell ? BELL_CLICK_GAIN : 1) * (accent ? 1 : 0.7), at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    gain.connect(context.destination);

    const frequency = accent ? 1200 : 900;
    // 4/4 keeps the square blip; other signatures get a triangle with a quiet octave on top.
    const voices: [OscillatorType, number, number][] = bell
      ? [["triangle", frequency, 1], ["sine", frequency * 2, 0.3]]
      : [["square", frequency, 1]];
    voices.forEach(([type, hz, level], i) => {
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.value = hz;
      if (level === 1) oscillator.connect(gain);
      else {
        const partial = context.createGain();
        partial.gain.value = level;
        oscillator.connect(partial);
        partial.connect(gain);
      }
      if (i === 0) oscillator.onended = () => gain.disconnect();
      oscillator.start(at);
      oscillator.stop(at + seconds + 0.02);
    });
  }
}
