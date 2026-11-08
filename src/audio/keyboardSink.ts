/** Where pitched sound goes: this computer's speakers, a connected MIDI keyboard, or both. */
export type SoundOutput = "computer" | "keyboard" | "both";

const STORAGE_KEY = "piano-mate.soundOutput";
const CHOICES: readonly SoundOutput[] = ["computer", "keyboard", "both"];

/** A pluck with no stated length rings out about this long on the keyboard. */
const DEFAULT_HOLD_SECONDS = 1.2;
/** Notes shorter than this still need a gap before their off, or some keyboards drop them. */
const MIN_HOLD_SECONDS = 0.04;

export function readStoredSoundOutput(): SoundOutput {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (CHOICES as readonly string[]).includes(stored)) return stored as SoundOutput;
  } catch {
    // Storage can be unavailable; fall through to the default.
  }
  return "computer";
}

export function storeSoundOutput(choice: SoundOutput): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // The choice still applies for this visit.
  }
}

const VOLUME_KEY = "piano-mate.keyboardVolume";
export const MIN_VOLUME = 0.2;
export const MAX_VOLUME = 1.5;

/** Keyboard loudness as a multiplier on each note's velocity; 1 plays notes as written. */
export function readStoredVolume(): number {
  try {
    const stored = Number(localStorage.getItem(VOLUME_KEY));
    if (stored >= MIN_VOLUME && stored <= MAX_VOLUME) return stored;
  } catch {
    // Fall through to the default.
  }
  return 1;
}

export function storeVolume(volume: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {
    // The choice still applies for this visit.
  }
}

export function noteOnMessage(pitch: number, velocity: number): number[] {
  return [0x90, pitch & 0x7f, Math.max(1, Math.min(127, Math.round(velocity * 127)))];
}

export function noteOffMessage(pitch: number): number[] {
  return [0x80, pitch & 0x7f, 0];
}

/** Sends notes to every connected MIDI output port, timed on the browser's performance.now() clock. */
export class KeyboardSink {
  /** Multiplies each note's velocity (the loudness on the keyboard). */
  volume = 1;
  /** Notes sent with a start time that hasn't arrived yet, so they can be called off. */
  private pending: { pitch: number; start: number; end: number }[] = [];
  /** Notes sent that haven't had their off time pass yet. */
  private sounding = new Map<number, number>();

  constructor(private readonly outputs: () => MIDIOutput[]) {}

  /** True when there is a keyboard to play on. */
  get available(): boolean {
    return this.outputs().length > 0;
  }

  play(pitch: number, velocity: number, holdSeconds: number | undefined, at: number | undefined): void {
    const ports = this.outputs();
    if (ports.length === 0) return;
    const now = performance.now();
    const start = Math.max(now, at ?? now);
    const end = start + Math.max(MIN_HOLD_SECONDS, holdSeconds ?? DEFAULT_HOLD_SECONDS) * 1000;
    // Re-striking a held key: release it first so the keyboard restarts the note.
    const previousEnd = this.sounding.get(pitch);
    for (const port of ports) {
      if (previousEnd !== undefined && previousEnd > start) port.send(noteOffMessage(pitch), start - 1);
      port.send(noteOnMessage(pitch, velocity * this.volume), start);
      port.send(noteOffMessage(pitch), end);
    }
    this.sounding.set(pitch, end);
    this.pending = this.pending.filter((n) => n.end > now);
    this.pending.push({ pitch, start, end });
  }

  /** Calls off notes scheduled ahead that haven't started; ones already sounding are released. */
  cancelPending(): void {
    const now = performance.now();
    const ports = this.outputs();
    // clear() drops queued messages; it is in the spec but missing from the DOM typings.
    for (const port of ports) (port as MIDIOutput & { clear?: () => void }).clear?.();
    for (const { pitch, start, end } of this.pending) {
      if (end <= now) continue;
      for (const port of ports) port.send(noteOffMessage(pitch));
      if (start > now) this.sounding.delete(pitch);
    }
    this.pending = [];
  }
}
