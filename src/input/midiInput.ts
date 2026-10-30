import type { NoteEvent } from "../music/types";
import type { NoteStream } from "./noteStream";

export type MidiStatus =
  | { state: "unsupported" }
  | { state: "idle" }
  | { state: "requesting" }
  | { state: "blocked"; reason: string }
  | { state: "ready"; devices: string[] };

/** One raw message as received, for the debug panel. */
export interface MidiMessageInfo {
  device: string;
  data: number[];
  /** The event's own timeStamp; browsers differ on its time base, so it's only reported. */
  eventTimeStamp: number;
  receivedAt: number;
  note: NoteEvent | null;
}

export interface MidiPortInfo {
  name: string;
  manufacturer: string;
  state: string;
  connection: string;
}

/**
 * Decodes one raw MIDI message into a note event, or null for anything that isn't a note.
 * Listens on every channel; a note-on with velocity 0 is a note-off (running-status convention).
 */
export function parseMidiMessage(data: ArrayLike<number>, time: number): NoteEvent | null {
  if (data.length < 3) return null;
  const type = data[0] & 0xf0;
  const pitch = data[1];
  const velocity = data[2];
  if (type === 0x90 && velocity > 0) {
    return { kind: "on", pitch, time, velocity: velocity / 127, source: "midi" };
  }
  if (type === 0x80 || type === 0x90) {
    return { kind: "off", pitch, time, source: "midi" };
  }
  return null;
}

/**
 * Feeds notes from every connected MIDI input into the stream, including devices plugged in later.
 * connect() asks the browser for MIDI access (it may prompt); call it from a user gesture
 * unless permission was already granted.
 */
export class MidiInput {
  private access: MIDIAccess | null = null;
  private status: MidiStatus;

  constructor(
    private readonly stream: NoteStream,
    private readonly onStatus: (status: MidiStatus) => void,
    private readonly onMessage?: (info: MidiMessageInfo) => void,
  ) {
    this.status = typeof navigator.requestMIDIAccess === "function" ? { state: "idle" } : { state: "unsupported" };
    onStatus(this.status);
  }

  /** True when the browser remembers an earlier grant, so connecting won't show a prompt. */
  async isPermissionGranted(): Promise<boolean> {
    try {
      const result = await navigator.permissions.query({ name: "midi" as PermissionName });
      return result.state === "granted";
    } catch {
      return false;
    }
  }

  /** Every input port the browser reports, connected or not. */
  ports(): MidiPortInfo[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((input) => ({
      name: input.name || "(unnamed)",
      manufacturer: input.manufacturer || "(unknown maker)",
      state: input.state,
      connection: input.connection,
    }));
  }

  async connect(): Promise<void> {
    if (this.status.state === "unsupported" || this.status.state === "requesting") return;
    if (this.access) return;
    this.setStatus({ state: "requesting" });
    try {
      this.access = await navigator.requestMIDIAccess();
    } catch (error) {
      const reason = error instanceof Error ? error.message || error.name : String(error);
      this.setStatus({ state: "blocked", reason });
      return;
    }
    this.access.addEventListener("statechange", () => this.bindInputs());
    this.bindInputs();
  }

  private bindInputs(): void {
    if (!this.access) return;
    const devices: string[] = [];
    for (const input of this.access.inputs.values()) {
      // Assigning (rather than addEventListener) keeps re-binding on hot-plug idempotent.
      input.onmidimessage = (event) => {
        if (!event.data) return;
        // Stamp on arrival: Firefox's MIDI event timeStamp isn't reliably on performance.now()'s clock.
        const receivedAt = performance.now();
        const note = parseMidiMessage(event.data, receivedAt);
        if (note) this.stream.emit(note);
        this.onMessage?.({
          device: input.name || "MIDI device",
          data: [...event.data],
          eventTimeStamp: event.timeStamp,
          receivedAt,
          note,
        });
      };
      if (input.state === "connected") devices.push(input.name || "MIDI device");
    }
    this.setStatus({ state: "ready", devices });
  }

  private setStatus(status: MidiStatus): void {
    this.status = status;
    this.onStatus(status);
  }
}
