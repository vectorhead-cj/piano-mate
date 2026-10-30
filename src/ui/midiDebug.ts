import type { MidiMessageInfo, MidiPortInfo, MidiStatus } from "../input/midiInput";
import { midiNoteName } from "../music/pitch";

const LOG_LIMIT = 40;
// Clock and active sensing arrive many times a second; count them instead of logging them.
const REALTIME_STATUS = new Set([0xf8, 0xfe]);

const MESSAGE_TYPES: Record<number, string> = {
  0x80: "note-off",
  0x90: "note-on",
  0xa0: "aftertouch",
  0xb0: "control",
  0xc0: "program",
  0xd0: "pressure",
  0xe0: "pitch-bend",
};

export interface MidiDebugSources {
  ports: () => MidiPortInfo[];
  keyboardRange: () => { lowest: number; highest: number };
  expectedPitch: () => number | undefined;
}

export interface MidiDebug {
  onStatus: (status: MidiStatus) => void;
  onMessage: (info: MidiMessageInfo) => void;
}

const named = (pitch: number) => `${midiNoteName(pitch)} (${pitch})`;
const hex = (data: number[]) => data.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");

function describeStatus(status: MidiStatus | undefined): string {
  if (!status) return "not started";
  switch (status.state) {
    case "blocked":
      return `blocked: ${status.reason}`;
    case "ready":
      return `ready, ${status.devices.length} connected input(s)`;
    default:
      return status.state;
  }
}

function browserName(): string {
  const ua = navigator.userAgent;
  const match = ua.match(/(Firefox|Edg|OPR|Chrome|Safari)\/([\d.]+)/);
  return match ? `${match[1] === "Edg" ? "Edge" : match[1]} ${match[2]}` : ua;
}

/** Where a pitch falls relative to the drawn keys, for spotting octave mismatches. */
function placement(pitch: number, range: { lowest: number; highest: number }): string {
  if (pitch < range.lowest) return `${range.lowest - pitch} semitones below the keyboard`;
  if (pitch > range.highest) return `${pitch - range.highest} semitones above the keyboard`;
  return "on the keyboard";
}

function describeMessage(info: MidiMessageInfo, range: { lowest: number; highest: number }): string {
  const [statusByte, a = 0, b = 0] = info.data;
  const type = MESSAGE_TYPES[statusByte & 0xf0];
  const channel = `ch${(statusByte & 0x0f) + 1}`;
  if (info.note) {
    const velocity = info.note.kind === "on" ? ` vel ${b}` : "";
    const where = info.note.kind === "on" ? `  · ${placement(a, range)}` : "";
    return `${channel} ${info.note.kind === "on" ? "note-on " : "note-off"} ${named(a)}${velocity}${where}`;
  }
  if (type === "control") return `${channel} control #${a} = ${b}`;
  if (type) return `${channel} ${type}`;
  return "system message";
}

/** Checkbox + panel that shows MIDI connection details and a log of incoming messages. */
export function bindMidiDebug(
  checkbox: HTMLInputElement,
  panel: HTMLElement,
  sources: MidiDebugSources,
): MidiDebug {
  const summary = panel.querySelector<HTMLElement>("[data-midi-summary]");
  const log = panel.querySelector<HTMLElement>("[data-midi-log]");
  const clearButton = panel.querySelector<HTMLButtonElement>("[data-midi-clear]");
  if (!summary || !log || !clearButton) throw new Error("MIDI debug panel is missing its parts");

  let status: MidiStatus | undefined;
  let lines: string[] = [];
  let realtimeCount = 0;
  let lastNoteOn: MidiMessageInfo | undefined;
  // Read when the note arrives, before practice moves on to the next target.
  let expectedAtLastNote: number | undefined;
  let lastTimeOffset: number | undefined;
  const held = new Set<number>();
  const startedAt = performance.now();
  let refreshTimer: number | undefined;

  const renderSummary = () => {
    const range = sources.keyboardRange();
    const expected = sources.expectedPitch();
    const ports = sources.ports();
    const rows: [string, string][] = [
      ["Browser", browserName()],
      ["Web MIDI", typeof navigator.requestMIDIAccess === "function" ? "available" : "not available"],
      ["Status", describeStatus(status)],
      ...(ports.length === 0
        ? ([["Inputs", "none reported"]] as [string, string][])
        : ports.map(
            (port, i): [string, string] => [
              i === 0 ? "Inputs" : "",
              `${port.name} · ${port.manufacturer} · ${port.state}/${port.connection}`,
            ],
          )),
      ["Keyboard", `${named(range.lowest)} – ${named(range.highest)}`],
      ["Expected", expected === undefined ? "— (rhythm mode or phrase done)" : named(expected)],
      ["Held", held.size === 0 ? "—" : [...held].sort((x, y) => x - y).map(named).join(", ")],
    ];
    if (lastNoteOn?.note) {
      const pitch = lastNoteOn.note.pitch;
      const target = expectedAtLastNote;
      const vsExpected =
        target === undefined
          ? ""
          : pitch === target
            ? ` · matched ${named(target)}`
            : ` · ${Math.abs(pitch - target)} semitones ${pitch < target ? "below" : "above"} ${named(target)}`;
      rows.push(["Last note", `${named(pitch)} · ${placement(pitch, range)}${vsExpected}`]);
    }
    if (lastTimeOffset !== undefined) {
      rows.push(["Event clock", `${lastTimeOffset.toFixed(1)} ms vs performance.now()`]);
    }
    rows.push(["Clock/sensing", `${realtimeCount} message(s), not logged`]);
    summary.textContent = rows.map(([label, value]) => `${label.padEnd(14)}${value}`).join("\n");
  };

  const render = () => {
    if (!checkbox.checked) return;
    renderSummary();
    log.textContent = lines.length === 0 ? "No messages yet. Play a key on the MIDI device." : lines.join("\n");
  };

  // Practice handles the note on a later tick; wait for it so "Expected" shows the new target.
  const renderSoon = () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(render, 30);
  };

  checkbox.addEventListener("change", () => {
    panel.hidden = !checkbox.checked;
    render();
  });
  clearButton.addEventListener("click", () => {
    lines = [];
    realtimeCount = 0;
    render();
  });
  panel.hidden = !checkbox.checked;

  return {
    onStatus(next) {
      status = next;
      render();
    },
    onMessage(info) {
      if (REALTIME_STATUS.has(info.data[0])) {
        realtimeCount++;
        return;
      }
      if (info.note?.kind === "on") {
        held.add(info.note.pitch);
        lastNoteOn = info;
        expectedAtLastNote = sources.expectedPitch();
      } else if (info.note) {
        held.delete(info.note.pitch);
      }
      lastTimeOffset = info.eventTimeStamp - info.receivedAt;
      const seconds = ((info.receivedAt - startedAt) / 1000).toFixed(2).padStart(7);
      const line = `${seconds}s  ${hex(info.data).padEnd(8)}  ${describeMessage(info, sources.keyboardRange())}`;
      lines = [line, ...lines].slice(0, LOG_LIMIT);
      renderSoon();
    },
  };
}
