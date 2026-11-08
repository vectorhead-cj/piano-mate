import type { KeyInfo } from "../music/keys";
import { ascendingScale } from "../music/scale";

const NOTE_MS = 150;
const HOLD_SECONDS = 0.25;
/** How long the finished scale stays lit. */
const LINGER_MS = 700;

export interface ScaleKeyboard {
  visibleRange: { lowest: number; highest: number };
  setScaleLit(midi: number, on: boolean): void;
}

/** Plays a key's scale quickly, lighting each key as it sounds and leaving them lit briefly. */
export class ScalePlayer {
  private timers: number[] = [];
  private lit: number[] = [];

  constructor(
    private readonly synth: { play(pitch: number, velocity?: number, holdSeconds?: number): void; unlock(): void },
    private readonly mainKeyboard: ScaleKeyboard,
  ) {}

  private override: ScaleKeyboard | null = null;

  private get keyboard(): ScaleKeyboard {
    return this.override ?? this.mainKeyboard;
  }

  /** Lights this keyboard instead of the main one (piece practice has its own); null goes back. */
  useKeyboard(keyboard: ScaleKeyboard | null): void {
    this.stop();
    this.override = keyboard;
  }

  /** Lights the key's scale on the keyboard without sounding it; null (or a played scale ending) clears it. */
  preview(key: KeyInfo | null): void {
    if (this.timers.length > 0) return;
    this.clearLit();
    if (!key) return;
    for (const pitch of ascendingScale(key, this.keyboard.visibleRange.lowest)) {
      this.keyboard.setScaleLit(pitch, true);
      this.lit.push(pitch);
    }
  }

  play(key: KeyInfo): void {
    this.stop();
    this.synth.unlock();
    const pitches = ascendingScale(key, this.keyboard.visibleRange.lowest);
    pitches.forEach((pitch, i) => {
      this.timers.push(
        window.setTimeout(() => {
          this.synth.play(pitch, 0.7, HOLD_SECONDS);
          this.keyboard.setScaleLit(pitch, true);
          this.lit.push(pitch);
        }, i * NOTE_MS),
      );
    });
    this.timers.push(window.setTimeout(() => this.stop(), (pitches.length - 1) * NOTE_MS + LINGER_MS));
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.clearLit();
  }

  private clearLit(): void {
    for (const pitch of this.lit) this.keyboard.setScaleLit(pitch, false);
    this.lit = [];
  }
}
